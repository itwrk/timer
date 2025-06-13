// --- グローバルステート ---
let allTasks = [];           // CSV 全データ
let sequenceTasks = [];      // 選択中タスク名のステップ一覧
let sequenceIndex = 0;       // 現在のステップインデックス
let remainingSeconds = 0;    
let timerId = null;          // メインタイマー用 ID
let preId = null;            // 事前カウントダウン用 ID
let taskStartTime = null;    // タスク開始時刻
let results = [];            // 実行結果ログ
let totalSeconds = 0;        // タスクの合計秒数（プログレスバー計算用）
let isCompletionHandled = false; // 終了処理が実行済みかのフラグ
let summaryResults = [];     // 過去のサマリー結果を保持する配列
let pausedRemainingSeconds = 0; // 一時停止時の残り時間
let pausedStartTime = null;  // 一時停止時の開始時刻
let isPaused = false;        // 一時停止中かどうかのフラグ

// --- LocalStorage キー定義 ---
const STORAGE_KEYS = {
  ALL_TASKS: 'lifelisten_timer_all_tasks',
  RESULTS: 'lifelisten_timer_results',
  SUMMARY_RESULTS: 'lifelisten_timer_summary_results',
  LAST_CSV: 'lifelisten_timer_last_csv'
};

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
const progressRingCircle = document.querySelector('.progress-ring-circle');
const clearResultsButton = document.getElementById('clearResultsButton');
const copyResultsButton = document.getElementById('copyResultsButton');

// 新規タスク追加関連のDOM要素
const addTaskHeader      = document.getElementById('addTaskHeader');
const addTaskContent     = document.getElementById('addTaskContent');
const newTaskName        = document.getElementById('newTaskName');
const newTaskIcon        = document.getElementById('newTaskIcon');
const addTaskButton      = document.getElementById('addTaskButton');

// 新規ステップ追加関連のDOM要素
const addStepSection     = document.getElementById('addStepSection');
const newStepName        = document.getElementById('newStepName');
const newStepText        = document.getElementById('newStepText');
const newStepSeconds     = document.getElementById('newStepSeconds');
const addStepButton      = document.getElementById('addStepButton');

// プログレスリングの円周を計算
const progressRingRadius = parseInt(progressRingCircle.getAttribute('r'));
const progressRingCircumference = 2 * Math.PI * progressRingRadius;
progressRingCircle.style.strokeDasharray = `${progressRingCircumference} ${progressRingCircumference}`;

// プログレスリングの更新関数
function updateProgressRing(percent) {
  const offset = progressRingCircumference - (percent / 100 * progressRingCircumference);
  progressRingCircle.style.strokeDashoffset = offset;
}

// タスク種類に応じたアイコンを取得する関数
function getTaskIcon(taskName) {
  const taskIcons = {
    'ラットプルダウン': 'fa-solid fa-arrow-down-wide-short',
    'スクワット': 'fa-solid fa-person-walking',
    'シーテッドロー': 'fa-solid fa-arrows-left-right',
    '机を上にする': 'fa-solid fa-table',
    '歯を磨く': 'fa-solid fa-tooth',
    '着替える': 'fa-solid fa-shirt',
    '請求書を作成する': 'fa-solid fa-file-invoice',
    '読書': 'fa-solid fa-book',
    '休憩': 'fa-solid fa-mug-hot',
    '食事': 'fa-solid fa-utensils',
    '書く': 'fa-solid fa-pen',
    // デフォルトアイコン
    'default': 'fa-solid fa-headphones'
  };
  
  return taskIcons[taskName] || taskIcons['default'];
}

// 休憩かどうかを判定する関数
function isRestPeriod(taskText) {
  return taskText.includes('休憩') || parseInt(taskText.match(/\d+/)?.[0] || 0) > 30;
}

// --- 無音ループを再生してAudioContextを起動し、バックグラウンドでも音声が止まらないように試みる
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
  
  // デバッグ用
  console.log('読み上げ:', text);
  
  return new Promise((resolve) => {
    u.onend = () => resolve();
    // 万が一onendが発火しない場合のフォールバック
    setTimeout(resolve, text.length * 200);
  });
}

// --- LocalStorageにデータを保存する関数 ---
function saveToLocalStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(`LocalStorageへの保存に失敗しました: ${error.message}`);
    return false;
  }
}

// --- LocalStorageからデータを読み込む関数 ---
function loadFromLocalStorage(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`LocalStorageからの読み込みに失敗しました: ${error.message}`);
    return null;
  }
}

// --- タスクデータを保存する関数 ---
function saveTasksData() {
  saveToLocalStorage(STORAGE_KEYS.ALL_TASKS, allTasks);
}

// --- 結果データを保存する関数 ---
function saveResultsData() {
  saveToLocalStorage(STORAGE_KEYS.RESULTS, results);
  saveToLocalStorage(STORAGE_KEYS.SUMMARY_RESULTS, summaryResults);
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
  
  // CSVテキストを保存
  saveToLocalStorage(STORAGE_KEYS.LAST_CSV, csvText);
  
  // タスクデータを保存
  saveTasksData();
  
  setupTaskButtons();
}

// --- デフォルトCSV自動ロード ---
window.addEventListener('DOMContentLoaded', () => {
  // LocalStorageからデータを復元
  restoreDataFromLocalStorage();
  
  // LocalStorageにデータがない場合はデフォルトCSVを読み込む
  if (allTasks.length === 0) {
    fetch('firstdata.csv')
      .then(res => res.text())
      .then(text => {
        parseAndSetupCSV(text);
      })
      .catch(() => console.warn('firstdata.csv の読み込みに失敗'));
  }
  
  // 初期状態でプログレスリングを非表示
  updateProgressRing(100);
  
  // 新規タスク追加セクションの折りたたみ/展開イベント設定
  addTaskHeader.addEventListener('click', () => {
    addTaskContent.classList.toggle('hidden');
    addTaskHeader.classList.toggle('active');
  });
  
  // 新規タスク追加ボタンのイベント設定
  addTaskButton.addEventListener('click', addNewTask);
  
  // 新規ステップ追加ボタンのイベント設定
  addStepButton.addEventListener('click', addNewStep);
});

// --- LocalStorageからデータを復元する関数 ---
function restoreDataFromLocalStorage() {
  // タスクデータの復元
  const savedTasks = loadFromLocalStorage(STORAGE_KEYS.ALL_TASKS);
  if (savedTasks && savedTasks.length > 0) {
    allTasks = savedTasks;
    setupTaskButtons();
  }
  
  // 結果データの復元
  const savedResults = loadFromLocalStorage(STORAGE_KEYS.RESULTS);
  if (savedResults) {
    results = savedResults;
  }
  
  // サマリーデータの復元
  const savedSummary = loadFromLocalStorage(STORAGE_KEYS.SUMMARY_RESULTS);
  if (savedSummary) {
    summaryResults = savedSummary;
    updateResultsTable();
  }
}

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
  currentTaskDisplay.innerHTML = '<i class="fas fa-info-circle"></i> タスクを選択してください';
  timerDisplay.textContent = '--:--';
  timerControls.classList.add('hidden');
  sequenceList.innerHTML = '';
  sequenceTitle.innerHTML = '<i class="fas fa-list-ol"></i> 実行予定のタスク';
  
  // 結果テーブルをクリアするが、過去のサマリーは保持
  results = [];
  updateResultsTable();
  
  // プログレスリングをリセット
  updateProgressRing(100);
  
  // ステップ追加セクションを非表示
  addStepSection.classList.add('hidden');

  // ボタン表示を元に戻す（バグ修正）
  document.getElementById('prevButton').style.display = '';
  document.getElementById('nextButton').style.display = '';
  document.getElementById('endButton').style.display = '';

  const names = [...new Set(allTasks.map(t=>t['タスク名']))];
  names.forEach(name => {
    const btn = document.createElement('button');
    const icon = getTaskIcon(name);
    btn.innerHTML = `<i class="${icon}"></i> ${name}`;
    btn.classList.add('task-btn');
    btn.addEventListener('click', ()=> startSequenceFor(name));
    taskButtons.appendChild(btn);
  });
}

// --- 新規タスク追加機能 ---
function addNewTask() {
  // 入力値の取得と検証
  const taskName = newTaskName.value.trim();
  const iconClass = newTaskIcon.value;
  
  // エラーメッセージの削除
  removeErrorMessages();
  
  // バリデーション
  if (!taskName) {
    showErrorMessage(newTaskName, 'タスク名を入力してください');
    return;
  }
  
  // 既存タスク名との重複チェック
  const existingTaskNames = [...new Set(allTasks.map(t => t['タスク名']))];
  if (existingTaskNames.includes(taskName)) {
    showErrorMessage(newTaskName, 'このタスク名は既に存在します');
    return;
  }
  
  // 新しいタスクを作成（最初のステップ）
  const newTask = {
    'タスク名': taskName,
    '項目名': '1回目',
    '読み上げテキスト': '1回目。いいぞ、その調子！',
    '秒数': 7,
    '順番': 1
  };
  
  // タスクをallTasksに追加
  allTasks.push(newTask);
  
  // LocalStorageに保存
  saveTasksData();
  
  // タスクボタンを再生成
  setupTaskButtons();
  
  // 入力フィールドをクリア
  newTaskName.value = '';
  newTaskIcon.selectedIndex = 0;
  
  // 成功メッセージの表示
  showSuccessMessage(addTaskContent, `新しいタスク「${taskName}」を追加しました`);
  
  // CSVの更新
  updateCSVData();
}

// --- エラーメッセージ表示関数 ---
function showErrorMessage(element, message) {
  // 既存のエラーメッセージを削除
  removeErrorMessages();
  
  // 新しいエラーメッセージを作成
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  
  // 要素の後ろに挿入
  element.parentNode.insertBefore(errorDiv, element.nextSibling);
  
  // 要素にエラースタイルを適用
  element.classList.add('error');
}

// --- エラーメッセージ削除関数 ---
function removeErrorMessages() {
  // エラーメッセージを削除
  document.querySelectorAll('.error-message').forEach(el => el.remove());
  
  // エラースタイルを削除
  document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
}

// --- 成功メッセージ表示関数 ---
function showSuccessMessage(container, message) {
  // 既存の成功メッセージを削除
  document.querySelectorAll('.success-message').forEach(el => el.remove());
  
  // 新しい成功メッセージを作成
  const successDiv = document.createElement('div');
  successDiv.className = 'success-message';
  successDiv.textContent = message;
  
  // コンテナの最後に追加
  container.appendChild(successDiv);
  
  // 3秒後に自動的に消える
  setTimeout(() => {
    successDiv.remove();
  }, 3000);
}

// --- CSVデータの更新関数 ---
function updateCSVData() {
  // CSVヘッダー
  const headers = ['タスク名', '項目名', '読み上げテキスト', '秒数', '順番'];
  
  // CSVデータの作成
  let csvContent = headers.join(',') + '\n';
  
  allTasks.forEach(task => {
    const row = headers.map(header => {
      let value = task[header] || '';
      // カンマやダブルクォートを含む場合はダブルクォートで囲む
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        value = `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvContent += row.join(',') + '\n';
  });
  
  // LocalStorageに保存
  saveToLocalStorage(STORAGE_KEYS.LAST_CSV, csvContent);
}

// --- タスク開始処理 ---
function startSequenceFor(name) {
  clearInterval(timerId);
  clearInterval(preId);
  
  // 一時停止状態をリセット
  isPaused = false;
  pauseResumeButton.innerHTML = '<i class="fas fa-pause"></i> 一時停止';
  
  // ボタン表示を元に戻す（バグ修正）
  document.getElementById('prevButton').style.display = '';
  document.getElementById('nextButton').style.display = '';
  document.getElementById('endButton').style.display = '';
  
  // 順番でソートして重複を排除
  const tasksWithSameNameAndOrder = {};
  
  allTasks
    .filter(t => t['タスク名'] === name)
    .forEach(task => {
      const orderKey = task['順番'] || 0;
      // 同じ順番のタスクがある場合は、最後に見つかったものを使用
      tasksWithSameNameAndOrder[orderKey] = task;
    });
  
  // オブジェクトから配列に戻して順番でソート
  sequenceTasks = Object.values(tasksWithSameNameAndOrder)
    .sort((a, b) => (a['順番'] || 0) - (b['順番'] || 0));
  
  sequenceIndex = 0;
  taskStartTime = new Date();   // 開始時刻を記録
  isCompletionHandled = false;  // 終了処理フラグをリセット
  renderSequenceList(name);
  
  // ステップ追加セクションを表示
  addStepSection.classList.remove('hidden');
  
  runNextStep();
}

// --- 実行予定リスト表示 (実行済み除外&ハイライト)&秒数編集 ---
function renderSequenceList(name) {
  sequenceTitle.innerHTML = `<i class="fas fa-list-ol"></i> ${name} のタスク`;
  sequenceList.innerHTML = '';
  sequenceTasks.forEach((task,i)=>{
    if (i<sequenceIndex) return; // 実行済みを除外
    const item = document.createElement('div');
    item.className = 'sequence-item'+(i===sequenceIndex?' active':'');
    
    // タスク内容に応じたアイコンを追加
    const isRest = isRestPeriod(task['読み上げテキスト']);
    const icon = isRest ? 'fa-solid fa-mug-hot' : 'fa-solid fa-person-running';
    
    // アイコンを含むラベル部分
    const labelContainer = document.createElement('div');
    labelContainer.className = 'label-container';
    labelContainer.innerHTML = `<i class="${icon}"></i>`;
    
    // 項目名入力フィールド
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = task['項目名'] || '';
    nameInput.className = 'seq-name-input';
    nameInput.dataset.index = i;
    nameInput.placeholder = '項目名を入力';
    nameInput.title = task['項目名'] || ''; // ツールチップでフルテキスト表示
    nameInput.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      const newName = e.target.value;
      
      // sequenceTasksの更新
      sequenceTasks[idx]['項目名'] = newName;
      
      // allTasksの対応するタスクを見つけて更新
      const taskIndex = allTasks.findIndex(t => 
        t['タスク名'] === sequenceTasks[idx]['タスク名'] && 
        t['順番'] === sequenceTasks[idx]['順番']
      );
      
      if (taskIndex !== -1) {
        allTasks[taskIndex]['項目名'] = newName;
        saveTasksData(); // LocalStorageに保存
        
        // 編集成功の視覚的フィードバック
        nameInput.classList.add('saved');
        setTimeout(() => {
          nameInput.classList.remove('saved');
        }, 500);
        
        // 現在実行中のタスクの場合は表示も更新
        if (idx === sequenceIndex) {
          updateCurrentTaskDisplay();
        }
        
        // ツールチップも更新
        nameInput.title = newName;
      }
    });
    
    // 読み上げテキスト入力フィールド
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = task['読み上げテキスト'] || '';
    textInput.className = 'seq-text-input';
    textInput.dataset.index = i;
    textInput.placeholder = '読み上げテキストを入力';
    textInput.title = task['読み上げテキスト'] || ''; // ツールチップでフルテキスト表示
    textInput.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      const newText = e.target.value;
      
      // sequenceTasksの更新
      sequenceTasks[idx]['読み上げテキスト'] = newText;
      
      // allTasksの対応するタスクを見つけて更新
      const taskIndex = allTasks.findIndex(t => 
        t['タスク名'] === sequenceTasks[idx]['タスク名'] && 
        t['順番'] === sequenceTasks[idx]['順番']
      );
      
      if (taskIndex !== -1) {
        allTasks[taskIndex]['読み上げテキスト'] = newText;
        saveTasksData(); // LocalStorageに保存
        
        // 編集成功の視覚的フィードバック
        textInput.classList.add('saved');
        setTimeout(() => {
          textInput.classList.remove('saved');
        }, 500);
        
        // ツールチップも更新
        textInput.title = newText;
      }
    });
    
    // 秒数入力フィールド
    const secondsInput = document.createElement('input');
    secondsInput.type = 'number';
    secondsInput.value = task['秒数'] || 0;
    secondsInput.className = 'seq-seconds-input';
    secondsInput.dataset.index = i;
    secondsInput.min = '1';
    secondsInput.max = '3600';
    secondsInput.addEventListener('change', e => {
      const idx = +e.target.dataset.index;
      const newSeconds = Math.max(1, Math.min(3600, +e.target.value || 1));
      
      // sequenceTasksの更新
      sequenceTasks[idx]['秒数'] = newSeconds;
      
      // allTasksの対応するタスクを見つけて更新
      const taskIndex = allTasks.findIndex(t => 
        t['タスク名'] === sequenceTasks[idx]['タスク名'] && 
        t['順番'] === sequenceTasks[idx]['順番']
      );
      
      if (taskIndex !== -1) {
        allTasks[taskIndex]['秒数'] = newSeconds;
        saveTasksData(); // LocalStorageに保存
        
        // 編集成功の視覚的フィードバック
        secondsInput.classList.add('saved');
        setTimeout(() => {
          secondsInput.classList.remove('saved');
        }, 500);
      }
      
      // 入力値を正規化
      e.target.value = newSeconds;
    });
    
    // 上下移動ボタン
    const moveUpButton = document.createElement('button');
    moveUpButton.innerHTML = '<i class="fas fa-arrow-up"></i>';
    moveUpButton.className = 'move-btn';
    moveUpButton.title = '上に移動';
    moveUpButton.disabled = i <= sequenceIndex + 1; // 実行済み+現在実行中の次は移動不可
    moveUpButton.addEventListener('click', () => moveSequenceTask(i, 'up'));
    
    const moveDownButton = document.createElement('button');
    moveDownButton.innerHTML = '<i class="fas fa-arrow-down"></i>';
    moveDownButton.className = 'move-btn';
    moveDownButton.title = '下に移動';
    moveDownButton.disabled = i >= sequenceTasks.length - 1;
    moveDownButton.addEventListener('click', () => moveSequenceTask(i, 'down'));
    
    // 削除ボタン
    const deleteButton = document.createElement('button');
    deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
    deleteButton.className = 'delete-btn';
    deleteButton.title = 'ステップを削除';
    deleteButton.disabled = i === sequenceIndex; // 現在実行中は削除不可
    deleteButton.addEventListener('click', () => deleteSequenceTask(i));
    
    // 要素を組み立て
    item.appendChild(labelContainer);
    item.appendChild(nameInput);
    item.appendChild(textInput);
    item.appendChild(secondsInput);
    
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';
    buttonContainer.appendChild(moveUpButton);
    buttonContainer.appendChild(moveDownButton);
    buttonContainer.appendChild(deleteButton);
    item.appendChild(buttonContainer);
    
    sequenceList.appendChild(item);
  });
}

// --- 新規ステップ追加機能 ---
function addNewStep() {
  // 入力値の取得と検証
  const stepName = newStepName.value.trim();
  const stepText = newStepText.value.trim();
  const stepSeconds = parseInt(newStepSeconds.value) || 7;
  
  // エラーメッセージの削除
  removeErrorMessages();
  
  // バリデーション
  if (!stepName) {
    showErrorMessage(newStepName, 'ステップ名を入力してください');
    return;
  }
  
  if (!stepText) {
    showErrorMessage(newStepText, '読み上げテキストを入力してください');
    return;
  }
  
  if (stepSeconds < 1 || stepSeconds > 3600) {
    showErrorMessage(newStepSeconds, '秒数は1〜3600の範囲で入力してください');
    return;
  }
  
  // 現在のタスク名を取得
  const currentTaskName = sequenceTasks.length > 0 ? sequenceTasks[0]['タスク名'] : '';
  if (!currentTaskName) {
    alert('タスクが選択されていません');
    return;
  }
  
  // 新しい順番を計算（最後に追加）
  const maxOrder = Math.max(...sequenceTasks.map(t => t['順番'] || 0), 0);
  const newOrder = maxOrder + 1;
  
  // 新しいステップを作成
  const newStep = {
    'タスク名': currentTaskName,
    '項目名': stepName,
    '読み上げテキスト': stepText,
    '秒数': stepSeconds,
    '順番': newOrder
  };
  
  // allTasksに追加
  allTasks.push(newStep);
  
  // sequenceTasksに追加
  sequenceTasks.push(newStep);
  
  // LocalStorageに保存
  saveTasksData();
  
  // 実行予定リストを再描画
  renderSequenceList(currentTaskName);
  
  // 入力フィールドをクリア
  newStepName.value = '';
  newStepText.value = '';
  newStepSeconds.value = '7';
  
  // 成功メッセージの表示
  showSuccessMessage(addStepSection.querySelector('.section-content'), `新しいステップを追加しました`);
  
  // CSVの更新
  updateCSVData();
}

// --- 「CSV エクスポート」ボタンでCSVファイルをダウンロード ---
exportCsvButton.addEventListener('click', () => {
  // CSVデータを更新
  updateCSVData();
  
  // LocalStorageから最新のCSVデータを取得
  const csvContent = loadFromLocalStorage(STORAGE_KEYS.LAST_CSV);
  if (!csvContent) {
    alert('エクスポートするデータがありません');
    return;
  }
  
  // CSVファイルをダウンロード
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'lifelisten_timer_data.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// --- シーケンスタスクの並べ替え ---
function moveSequenceTask(index, direction) {
  if (direction === 'up' && index > sequenceIndex + 1) {
    // 上に移動
    const temp = sequenceTasks[index];
    sequenceTasks[index] = sequenceTasks[index - 1];
    sequenceTasks[index - 1] = temp;
    
    // 順番を更新
    const tempOrder = sequenceTasks[index]['順番'];
    sequenceTasks[index]['順番'] = sequenceTasks[index - 1]['順番'];
    sequenceTasks[index - 1]['順番'] = tempOrder;
    
  } else if (direction === 'down' && index < sequenceTasks.length - 1) {
    // 下に移動
    const temp = sequenceTasks[index];
    sequenceTasks[index] = sequenceTasks[index + 1];
    sequenceTasks[index + 1] = temp;
    
    // 順番を更新
    const tempOrder = sequenceTasks[index]['順番'];
    sequenceTasks[index]['順番'] = sequenceTasks[index + 1]['順番'];
    sequenceTasks[index + 1]['順番'] = tempOrder;
  }
  
  // allTasksの対応するタスクも更新
  sequenceTasks.forEach(task => {
    const taskIndex = allTasks.findIndex(t => 
      t['タスク名'] === task['タスク名'] && 
      t['読み上げテキスト'] === task['読み上げテキスト'] &&
      t['秒数'] === task['秒数']
    );
    
    if (taskIndex !== -1) {
      allTasks[taskIndex]['順番'] = task['順番'];
    }
  });
  
  // LocalStorageに保存
  saveTasksData();
  
  // 実行予定リストを再描画
  renderSequenceList(sequenceTasks[0]['タスク名']);
  
  // CSVの更新
  updateCSVData();
}

// --- 現在のタスク表示を更新する関数 ---
function updateCurrentTaskDisplay() {
  if (sequenceIndex >= sequenceTasks.length) return;
  
  const task = sequenceTasks[sequenceIndex];
  const isRest = isRestPeriod(task['読み上げテキスト']);
  const icon = isRest ? 'fa-solid fa-mug-hot' : 'fa-solid fa-person-running';
  
  // 項目名と読み上げテキストを表示
  const stepName = task['項目名'] || '';
  const readText = task['読み上げテキスト'] || '';
  
  currentTaskDisplay.innerHTML = `<i class="${icon}"></i> ${task['タスク名']}：${stepName}：${readText}`;
}

// --- 次のステップを実行 ---
async function runNextStep() {
  if (sequenceIndex >= sequenceTasks.length) {
    handleCompletion();
    return;
  }
  
  const task = sequenceTasks[sequenceIndex];
  const isRest = isRestPeriod(task['読み上げテキスト']);
  const icon = isRest ? 'fa-solid fa-mug-hot' : 'fa-solid fa-person-running';
  
  // タイマーコントロールを表示
  timerControls.classList.remove('hidden');
  
  // 初回のみ5秒カウントダウンと開始アナウンス
  if (sequenceIndex === 0) {
    // 「タスク名を開始します」の読み上げ
    speak(`${task['タスク名']}を開始します`);
    
    let preCount = 5;
    currentTaskDisplay.innerHTML = `<i class="${icon}"></i> ${task['タスク名']}を開始します... ${preCount}`;
    
    // 一時停止状態を監視するための変数
    let localPaused = false;
    
    // 一時停止ボタンのイベントリスナー
    const pauseListener = () => {
      localPaused = !localPaused;
      isPaused = localPaused;
      pauseResumeButton.innerHTML = localPaused ? 
        '<i class="fas fa-play"></i> 再開' : 
        '<i class="fas fa-pause"></i> 一時停止';
    };
    
    // 一時停止ボタンにイベントリスナーを追加
    pauseResumeButton.addEventListener('click', pauseListener);
    
    // カウントダウン処理
    return new Promise((resolve) => {
      preId = setInterval(() => {
        if (localPaused) return; // 一時停止中は何もしない
        
        preCount--;
        if (preCount <= 0) {
          clearInterval(preId);
          // イベントリスナーを削除
          pauseResumeButton.removeEventListener('click', pauseListener);
          // 最初のステップの表示を更新
          updateCurrentTaskDisplay();
          // 音声読み上げとタイマーを同時開始
          speak(task['読み上げテキスト']);
          startTimer(task['秒数']);
          resolve();
        } else {
          currentTaskDisplay.innerHTML = `<i class="${icon}"></i> ${task['タスク名']}を開始します... ${preCount}`;
        }
      }, 1000);
    });
  } else {
    // 表示を更新
    updateCurrentTaskDisplay();
    // 音声読み上げとタイマーを同時開始
    speak(task['読み上げテキスト']);
    startTimer(task['秒数']);
  }
  
  // 実行予定リストを更新
  renderSequenceList(task['タスク名']);
}

// --- タイマー開始 ---
function startTimer(seconds) {
  remainingSeconds = seconds;
  totalSeconds = seconds;
  updateTimerDisplay();
  
  timerId = setInterval(() => {
    if (isPaused) return; // 一時停止中は何もしない
    
    remainingSeconds--;
    updateTimerDisplay();
    
    if (remainingSeconds <= 0) {
      clearInterval(timerId);
      
      // 結果を記録
      const task = sequenceTasks[sequenceIndex];
      const stepName = task['項目名'] || '';
      
      results.push({
        date: new Date().toLocaleString(),
        seconds: task['秒数'],
        content: `${task['タスク名']}：${stepName}`
      });
      
      // 次のステップへ
      sequenceIndex++;
      runNextStep();
    }
  }, 1000);
}

// --- タイマー表示更新 ---
function updateTimerDisplay() {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  // プログレスリングの更新
  const percent = (remainingSeconds / totalSeconds) * 100;
  updateProgressRing(percent);
}

// --- 一時停止/再開ボタン ---
pauseResumeButton.addEventListener('click', () => {
  if (isPaused) {
    // 再開
    isPaused = false;
    pauseResumeButton.innerHTML = '<i class="fas fa-pause"></i> 一時停止';
  } else {
    // 一時停止
    isPaused = true;
    pauseResumeButton.innerHTML = '<i class="fas fa-play"></i> 再開';
  }
});

// --- 前へボタン ---
document.getElementById('prevButton').addEventListener('click', () => {
  if (sequenceIndex > 0) {
    clearInterval(timerId);
    clearInterval(preId);
    sequenceIndex--;
    runNextStep();
  }
});

// --- 次へボタン ---
document.getElementById('nextButton').addEventListener('click', () => {
  clearInterval(timerId);
  clearInterval(preId);
  
  // 結果を記録
  if (sequenceIndex < sequenceTasks.length) {
    const task = sequenceTasks[sequenceIndex];
    const stepName = task['項目名'] || '';
    
    results.push({
      date: new Date().toLocaleString(),
      seconds: task['秒数'] - remainingSeconds,
      content: `${task['タスク名']}：${stepName} (スキップ)`
    });
  }
  
  sequenceIndex++;
  runNextStep();
});

// --- 終了ボタン ---
endButton.addEventListener('click', () => {
  clearInterval(timerId);
  clearInterval(preId);
  handleCompletion();
});

// --- 達成音を再生する関数 ---
function playCompletionSound() {
  try {
    // Web Audio APIを使用して短い達成音を生成
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 達成音の特性
    const duration = 0.5; // 音の長さ（秒）
    
    // 主音（明るい音色）
    const oscillator1 = audioCtx.createOscillator();
    oscillator1.type = 'sine';
    oscillator1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
    oscillator1.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.1); // G5
    oscillator1.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.2); // C6
    
    // ゲイン（音量）ノード
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    // 接続して再生
    oscillator1.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator1.start();
    oscillator1.stop(audioCtx.currentTime + duration);
    
    return true;
  } catch (error) {
    console.error('達成音の再生に失敗しました:', error);
    return false;
  }
}

// --- 達成演出を表示する関数 ---
function showCompletionEffect() {
  // 演出要素の取得
  const effectOverlay = document.getElementById('completionEffect');
  const starburst = document.querySelector('.starburst');
  const completionMessage = currentTaskDisplay;
  
  // 演出の実行
  if (effectOverlay && starburst) {
    // オーバーレイとスターバーストをアクティブ化
    effectOverlay.classList.add('active');
    starburst.classList.add('active');
    
    // 完了メッセージにアニメーションクラスを追加
    completionMessage.classList.add('completion-message');
    
    // 達成音を再生
    playCompletionSound();
    
    // 演出の終了（0.8秒後）
    setTimeout(() => {
      effectOverlay.classList.remove('active');
      starburst.classList.remove('active');
      completionMessage.classList.remove('completion-message');
    }, 800);
  }
}

// --- 終了処理 ---
async function handleCompletion() {
  if (isCompletionHandled) return;
  isCompletionHandled = true;
  
  // タイマー表示をクリア
  timerDisplay.textContent = '--:--';
  
  // プログレスリングをリセット
  updateProgressRing(100);
  
  // 合計時間を計算
  const totalTime = results.reduce((sum, r) => sum + r.seconds, 0);
  
  // サマリー結果を追加
  let taskName = '';
  if (results.length > 0 && sequenceTasks.length > 0) {
    taskName = sequenceTasks[0]['タスク名'];
    const endTime = new Date();
    summaryResults.push({
      date: endTime.toLocaleString(),
      seconds: totalTime,
      content: `${taskName} (${results.length}ステップ)`,
      startTime: taskStartTime ? taskStartTime.toLocaleString() : endTime.toLocaleString(),
      endTime: endTime.toLocaleString()
    });
  }
  
  // 結果を保存
  saveResultsData();
  
  // 結果テーブルを更新
  updateResultsTable();
  
  // ステップ追加セクションを非表示
  addStepSection.classList.add('hidden');
  
  // 「タスク名を終了します。お疲れ様でした」の読み上げ
  currentTaskDisplay.innerHTML = '<i class="fas fa-check-circle"></i> 完了しました！';
  
  // 一時停止ボタンを表示したまま、他のコントロールを非表示
  // ボタンの表示/非表示ではなく、CSSクラスで制御するように修正
  timerControls.classList.remove('hidden');
  document.getElementById('prevButton').classList.add('temp-hidden');
  document.getElementById('nextButton').classList.add('temp-hidden');
  document.getElementById('endButton').classList.add('temp-hidden');
  
  // 一時停止状態を監視するための変数
  let localPaused = false;
  
  // 一時停止ボタンのイベントリスナー
  const pauseListener = () => {
    localPaused = !localPaused;
    isPaused = localPaused;
    pauseResumeButton.innerHTML = localPaused ? 
      '<i class="fas fa-play"></i> 再開' : 
      '<i class="fas fa-pause"></i> 一時停止';
    
    // 音声の一時停止/再開
    if (localPaused) {
      speechSynthesis.pause();
    } else {
      speechSynthesis.resume();
    }
  };
  
  // 一時停止ボタンにイベントリスナーを追加
  pauseResumeButton.addEventListener('click', pauseListener);
  
  // 達成演出を表示（非同期で実行）
  showCompletionEffect();
  
  // 終了メッセージの読み上げ
  try {
    if (taskName) {
      await speak(`${taskName}を終了します。お疲れ様でした`);
    } else {
      await speak(`タイマーを終了します。お疲れ様でした`);
    }
  } finally {
    // イベントリスナーを削除
    pauseResumeButton.removeEventListener('click', pauseListener);
    
    // すべてのコントロールを非表示
    timerControls.classList.add('hidden');
    
    // 一時的な非表示クラスを削除して、次回のタスク開始時に正しく表示されるようにする
    document.getElementById('prevButton').classList.remove('temp-hidden');
    document.getElementById('nextButton').classList.remove('temp-hidden');
    document.getElementById('endButton').classList.remove('temp-hidden');
  }
}

// --- 結果テーブル更新 ---
function updateResultsTable() {
  resultsTableBody.innerHTML = '';
  
  // 今回の結果を表示
  results.forEach(result => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${result.date}</td>
      <td>${result.seconds}</td>
      <td>${result.content}</td>
    `;
    resultsTableBody.appendChild(row);
  });
  
  // 過去のサマリー結果を表示（新しい形式で）
  summaryResults.forEach(result => {
    const row = document.createElement('tr');
    row.className = 'summary-row';
    
    // タスク名を抽出
    const taskNameMatch = result.content.match(/^(.+?)\s*\(/);
    const taskName = taskNameMatch ? taskNameMatch[1] : result.content;
    
    // 時間を分と秒に変換
    const minutes = Math.floor(result.seconds / 60);
    const seconds = result.seconds % 60;
    const timeString = `${minutes}分${seconds}秒`;
    
    // 開始時刻と終了時刻を使用（保存されている場合）
    let startTimeString, endTimeString;
    if (result.startTime && result.endTime) {
      startTimeString = result.startTime;
      endTimeString = result.endTime;
    } else {
      // 古いデータの場合は従来通り計算
      const endDate = new Date(result.date);
      const startDate = new Date(endDate.getTime() - (result.seconds * 1000));
      
      startTimeString = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} ${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}:${startDate.getSeconds().toString().padStart(2, '0')}`;
      endTimeString = `${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()} ${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}:${endDate.getSeconds().toString().padStart(2, '0')}`;
    }
    
    row.innerHTML = `
      <td>**${taskName}の合計実行時間**<br>${timeString}<br>**開始: ${startTimeString} 〜 終了: ${endTimeString}**</td>
      <td>${result.seconds}</td>
      <td>${result.content}</td>
    `;
    resultsTableBody.appendChild(row);
  });
}

// --- ログ消去ボタン ---
clearResultsButton.addEventListener('click', () => {
  if (confirm('実行結果ログを消去しますか？')) {
    results = [];
    summaryResults = [];
    saveResultsData();
    updateResultsTable();
  }
});

// --- ログ一括コピーボタン ---
copyResultsButton.addEventListener('click', () => {
  let copyText = '';
  
  // 今回の結果をコピー
  if (results.length > 0) {
    copyText += '=== 今回の実行結果 ===\n';
    results.forEach(result => {
      copyText += `${result.date}\t${result.seconds}秒\t${result.content}\n`;
    });
    copyText += '\n';
  }
  
  // 過去のサマリー結果をコピー
  if (summaryResults.length > 0) {
    copyText += '=== 過去の実行履歴 ===\n';
    summaryResults.forEach(result => {
      // タスク名を抽出
      const taskNameMatch = result.content.match(/^(.+?)\s*\(/);
      const taskName = taskNameMatch ? taskNameMatch[1] : result.content;
      
      // 時間を分と秒に変換
      const minutes = Math.floor(result.seconds / 60);
      const seconds = result.seconds % 60;
      const timeString = `${minutes}分${seconds}秒`;
      
      // 開始時刻と終了時刻を使用（保存されている場合）
      let startTimeString, endTimeString;
      if (result.startTime && result.endTime) {
        startTimeString = result.startTime;
        endTimeString = result.endTime;
      } else {
        // 古いデータの場合は従来通り計算
        const endDate = new Date(result.date);
        const startDate = new Date(endDate.getTime() - (result.seconds * 1000));
        
        startTimeString = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} ${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}:${startDate.getSeconds().toString().padStart(2, '0')}`;
        endTimeString = `${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()} ${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}:${endDate.getSeconds().toString().padStart(2, '0')}`;
      }
      
      copyText += `**${taskName}の合計実行時間**\n`;
      copyText += `${timeString}\n`;
      copyText += `**開始: ${startTimeString} 〜 終了: ${endTimeString}**\n\n`;
    });
  }
  
  if (copyText === '') {
    alert('コピーするログがありません');
    return;
  }
  
  // クリップボードにコピー
  navigator.clipboard.writeText(copyText).then(() => {
    // 成功時の視覚的フィードバック
    const originalText = copyResultsButton.innerHTML;
    copyResultsButton.innerHTML = '<i class="fas fa-check"></i> コピー完了';
    copyResultsButton.style.backgroundColor = '#28a745';
    
    setTimeout(() => {
      copyResultsButton.innerHTML = originalText;
      copyResultsButton.style.backgroundColor = '';
    }, 1500);
  }).catch(() => {
    // フォールバック: テキストエリアを使用
    const textArea = document.createElement('textarea');
    textArea.value = copyText;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    
    // 成功時の視覚的フィードバック
    const originalText = copyResultsButton.innerHTML;
    copyResultsButton.innerHTML = '<i class="fas fa-check"></i> コピー完了';
    copyResultsButton.style.backgroundColor = '#28a745';
    
    setTimeout(() => {
      copyResultsButton.innerHTML = originalText;
      copyResultsButton.style.backgroundColor = '';
    }, 1500);
  });
});

