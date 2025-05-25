// --- グローバルステート ---
let allTasks = [];           // CSV 全データ
let sequenceTasks = [];      // 選択中タスク名のステップ一覧
let sequenceIndex = 0;       // 現在のステップインデックス
let remainingSeconds = 0;    
let timerId = null;          // メインタイマー用 ID
let preId = null;            // 事前カウントダウン用 ID
let taskStartTime = null;    // タスク開始時刻
let results = [];            // 実行結果ログ

// --- DOM取得 ---
const importCsvInput     = document.getElementById('importCsvInput');
const loadCsvButton      = document.getElementById('loadCsvButton');
const exportCsvButton    = document.getElementById('exportCsvButton');
const taskButtons        = document.getElementById('taskButtons');
const currentTaskDisplay = document.getElementById('currentTaskDisplay');
const timerDisplay       = document.getElementById('timerDisplay');
const timerControls      = document.getElementById('timerControls');
const pauseResumeButton  = document.getElementById('pauseResumeButton');
const endButton          = document.getElementById('endButton');
const sequenceTitle      = document.getElementById('sequenceTitle');
const sequenceList       = document.getElementById('sequenceList');
const resultsTableBody   = document.querySelector('#resultsTable tbody');



// --- スクリプトの先頭あたりに置く ---
// 無音ループを再生してAudioContextを起動し、バックグラウンドでも音声が止まらないように試みる
function enableBackgroundAudioHack() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  osc.frequency.value = 0;      // 無音
  osc.connect(ctx.destination);
  osc.start();
  // （必要に応じて osc.stop() で停止できます）
}

// --- DOMContentLoaded の外でもOK ---
// 最初の「タップ」イベントを拾って一度だけ呼び出す
document.addEventListener('click', function initBgAudio() {
  enableBackgroundAudioHack();
  document.removeEventListener('click', initBgAudio);
});



// --- 音声読み上げ関数 ---
function speak(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// --- CSV テキストをパースして UI をセットアップ ---
function parseAndSetupCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    alert('CSVに有効なデータがありません');
    return;
  }
  const headers = lines[0].split(',').map(h => h.trim());
  allTasks = lines.slice(1).map(line => {
    const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
    return headers.reduce((obj, h, i) => {
      let v = (cols[i]||'').replace(/^"|"$/g,'').trim();
      if (h==='秒数'||h==='順番') v = Number(v);
      obj[h] = v;
      return obj;
    }, {});
  });
  setupTaskButtons();
}

// --- デフォルトCSV自動ロード ---
window.addEventListener('DOMContentLoaded', () => {
  fetch('firstdata.csv')
    .then(res => res.text())
    .then(text => parseAndSetupCSV(text))
    .catch(() => console.warn('firstdata.csv の読み込みに失敗'));
});

// --- 「読み込む」ボタンでユーザーCSVを読み込む ---
loadCsvButton.addEventListener('click', () => {
  const file = importCsvInput.files[0];
  if (!file) return alert('CSVファイルを選択してください');
  const reader = new FileReader();
  reader.onload = e => parseAndSetupCSV(e.target.result);
  reader.readAsText(file, 'UTF-8');
});

// --- タスク名ボタン生成 ---
function setupTaskButtons() {
  taskButtons.innerHTML = '';
  currentTaskDisplay.textContent = 'タスクを選択してください';
  timerDisplay.textContent = '--:--';
  timerControls.classList.add('hidden');
  sequenceList.innerHTML = '';
  resultsTableBody.innerHTML = '';
  sequenceTitle.textContent = '実行予定のタスク';
  results = [];

  const names = [...new Set(allTasks.map(t=>t['タスク名']))];
  names.forEach(name => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.classList.add('task-btn');
    btn.addEventListener('click', ()=> startSequenceFor(name));
    taskButtons.appendChild(btn);
  });
}

// --- タスク開始処理 ---
function startSequenceFor(name) {
  clearInterval(timerId);
  clearInterval(preId);
  sequenceTasks = allTasks
    .filter(t=>t['タスク名']===name)
    .sort((a,b)=> (a['順番']||0)-(b['順番']||0));
  sequenceIndex = 0;
  taskStartTime = new Date();   // 開始時刻を記録
  renderSequenceList(name);
  runNextStep();
}

// --- 実行予定リスト表示 (実行済み除外&ハイライト)&秒数編集 ---
function renderSequenceList(name) {
  sequenceTitle.textContent = `${name} のタスク`;
  sequenceList.innerHTML = '';
  sequenceTasks.forEach((task,i)=>{
    if (i<sequenceIndex) return; // 実行済みを除外
    const item = document.createElement('div');
    item.className = 'sequence-item'+(i===sequenceIndex?' active':'');
    const label = document.createElement('span');
    label.textContent = task['読み上げテキスト']||'';
    const inp = document.createElement('input');
    inp.type='number'; inp.value=task['秒数'];
    inp.className='seq-time-input'; inp.dataset.index=i;
    inp.addEventListener('change',e=>{
      const idx=+e.target.dataset.index, v=+e.target.value;
      sequenceTasks[idx]['秒数']=v;
      if(idx===sequenceIndex){
        remainingSeconds=v; updateTimerDisplay();
      }
    });
    item.append(label,inp,document.createTextNode(' 秒'));
    sequenceList.appendChild(item);
  });
}

// --- 次ステップ実行 ---
function runNextStep() {
  // 全完了時
  if(sequenceIndex>=sequenceTasks.length){
    if(preId!==null){clearInterval(preId);preId=null;}
    if(timerId!==null){clearInterval(timerId);timerId=null;}
    const name=sequenceTasks[0]?.['タスク名']||'';
    const msg=`${name}を終了します、お疲れ様でした`;
    currentTaskDisplay.textContent=msg; speak(msg);
    timerDisplay.textContent='--:--'; timerControls.classList.add('hidden');
    recordSummary();  // ←サマリー表示
    return;
  }
  const task=sequenceTasks[sequenceIndex];
  remainingSeconds=task['秒数'];
  // 最初のみ5秒待機
  if(sequenceIndex===0){
    let cnt=5;
    currentTaskDisplay.textContent=`${task['タスク名']}を開始します… ${cnt}`;
    speak(`${task['タスク名']}を開始します`);
    timerDisplay.textContent=cnt;
    preId=setInterval(()=>{
      cnt--; timerDisplay.textContent=cnt;
      if(cnt<=0){clearInterval(preId);preId=null; startStep(task);}
    },1000);
  } else {
    startStep(task);
  }
}

// --- 各ステップ処理 ---
function startStep(task){
  if(preId!==null){clearInterval(preId);preId=null;}
  const txt=task['読み上げテキスト']||'';
  speak(txt);
  currentTaskDisplay.textContent=`${task['タスク名']}：${txt}`;
  recordResult(task,task['秒数']);
  updateTimerDisplay();
  timerControls.classList.remove('hidden');
  renderSequenceList(task['タスク名']);
  timerId=setInterval(()=>{
    remainingSeconds--; updateTimerDisplay();
    if(remainingSeconds<=0){
      clearInterval(timerId); timerId=null;
      sequenceIndex++; runNextStep();
    }
  },1000);
}

// --- 表示更新 ---
function updateTimerDisplay(){
  const m=String(Math.floor(remainingSeconds/60)).padStart(2,'0'),
        s=String(remainingSeconds%60).padStart(2,'0');
  timerDisplay.textContent=`${m}:${s}`;
}

// --- 結果ログ記録 ---
function recordResult(task,elapsed){
  const now=new Date().toLocaleString(),
        content=task['読み上げテキスト']||'';
  results.push({time:now,elapsed,content});
  updateResultsTable();
}
function updateResultsTable(){
  resultsTableBody.innerHTML='';
  results.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${r.time}</td><td>${r.elapsed}</td><td>${r.content}</td>`;
    resultsTableBody.appendChild(tr);
  });
}

// --- サマリー記録と表示 ---
function recordSummary(){
  // 開始〜終了時間、合計を計算
  const end=new Date(),
        totalSec=Math.floor((end-taskStartTime)/1000),
        m=Math.floor(totalSec/60), s=totalSec%60,
        totalStr=`${m}分${s}秒`,
        startStr=taskStartTime.toLocaleString(),
        endStr=end.toLocaleString();
  // テーブル末尾に追加
  const tr=document.createElement('tr');
  tr.className='summary-row';
  tr.innerHTML=`
    <td>合計実行時間</td>
    <td>${totalStr}</td>
    <td>開始: ${startStr} 〜 終了: ${endStr}</td>
  `;
  resultsTableBody.appendChild(tr);
}

// --- 一時停止／再開 ---
pauseResumeButton.addEventListener('click',()=>{
  if(!timerId) return;
  if(pauseResumeButton.textContent==='一時停止'){
    clearInterval(timerId); speechSynthesis.pause();
    pauseResumeButton.textContent='再開';
  } else {
    pauseResumeButton.textContent='一時停止';
    speechSynthesis.resume();
    timerId=setInterval(()=>{
      remainingSeconds--; updateTimerDisplay();
      if(remainingSeconds<=0){
        clearInterval(timerId); timerId=null;
        sequenceIndex++; runNextStep();
      }
    },1000);
  }
});

// --- 終了ボタン処理 ---
endButton.addEventListener('click',()=>{
  if(preId!==null){clearInterval(preId);preId=null;}
  if(timerId!==null){clearInterval(timerId);timerId=null;}
  speechSynthesis.cancel();
  const name=sequenceTasks[0]?.['タスク名']||'',
        msg=`${name}を終了します、お疲れ様でした`;
  currentTaskDisplay.textContent=msg; speak(msg);
  timerDisplay.textContent='--:--'; timerControls.classList.add('hidden');
  recordSummary(); sequenceIndex=sequenceTasks.length;
});

// --- CSVエクスポート ---
exportCsvButton.addEventListener('click',()=>{
  if(allTasks.length===0){
    alert('まずCSVをインポートしてください');
    return;
  }
  const headers=['タスク名','順番','秒数','読み上げテキスト','項目名'];
  const rows=allTasks.map(task=>headers.map(h=>{
    const v=task[h]||''; return String(v).includes(',')?`"${v}"`:v;
  }).join(','));
  const csv=[headers.join(','),...rows].join('\n'),
        blob=new Blob([csv],{type:'text/csv'}),
        url=URL.createObjectURL(blob),
        a=document.createElement('a');
  a.href=url; a.download='tasks_export.csv'; a.click();
  URL.revokeObjectURL(url);
});
