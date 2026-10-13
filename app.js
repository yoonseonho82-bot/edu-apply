// app.js – 화면 동작 (입력 받기, 목록 그리기, 버튼 이벤트)
// 규칙 판정은 logic.js 함수를 부른다.

let apps = [];     // edu_apps
let courses = [];  // edu_courses

// ===== 저장 위치 =====
// 데이터를 읽고 쓰는 곳은 이 네 함수뿐이다.
// 저장 위치를 바꿀 때는 이 부분만 고치면 된다.
// 저장소 : Supabase DB (주소·키는 config.js, 표·규칙은 supabase_setup.sql)
const TABLE_APPS = 'edu_apps';
const TABLE_COURSES = 'edu_courses';

let db = null; // Supabase 연결

function getDb() {
  if (db) return db;
  if (!window.supabase) throw new Error('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return db;
}

// DB가 거부하면 그 이유를 throw한다 (F-11 – 화면 함수가 메시지로 보여 줌)
function check(result) {
  const err = result.error;
  if (!err) return result.data;
  if (err.code === '23505') throw new Error('중복 신청 : 이미 같은 과정에 신청한 사람입니다.'); // 동시 신청 시 R-01 고유 색인
  throw new Error(err.message);
}

// 전체 불러오기
async function loadData() {
  const [appRows, courseRows] = (await Promise.all([
    getDb().from(TABLE_APPS).select('*').order('id'),
    getDb().from(TABLE_COURSES).select('*').order('course'),
  ])).map(check);
  apps = appRows.map(r => ({
    id: r.id, course: r.course, date: r.date, hours: Number(r.hours),
    name: r.name, team: r.team, status: r.status, createdAt: Date.parse(r.created_at), // created_at ↔ createdAt (3회차처럼 숫자로)
  }));
  courses = courseRows.map(r => ({ course: r.course, capacity: Number(r.capacity) }));
}

// 신청 1건 저장 (상태는 DB가 '신청'으로, 처음 보는 과정은 DB가 정원 5명으로 등록)
async function insertApp(app) {
  check(await getDb().from(TABLE_APPS).insert({
    course: app.course, date: app.date, hours: app.hours, name: app.name, team: app.team,
  }));
  await loadData();
}

// 상태 변경 저장 (R-04는 DB에서도 검사)
async function updateStatus(id, newStatus) {
  check(await getDb().from(TABLE_APPS).update({ status: newStatus }).eq('id', id));
  await loadData();
}

// 정원 변경 저장
async function updateCapacity(course, capacity) {
  check(await getDb().from(TABLE_COURSES).update({ capacity }).eq('course', course));
  await loadData();
}
// ===== 저장 위치 끝 =====


// ---- 화면 도우미 ----
function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn('요소 없음: ' + id);
  return el;
}

function make(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text; // 입력값은 항상 textContent로 표시
  if (className) el.className = className;
  return el;
}

function showMessage(text, type) {
  const box = $('msgBox');
  if (!box) return;
  box.textContent = text;
  box.className = 'msg ' + (type || '');
}


// ---- F-01 ~ F-03 신청 ----
async function addApplication() {
  const app = {
    course: $('courseInput').value.trim(),
    date: $('dateInput').value,
    hours: Number($('hoursInput').value),
    name: normName($('nameInput').value),
    team: $('teamInput').value.trim(),
    status: STATUS.APPLY,
  };

  if (!app.course || !app.date || !app.name || !app.team || !(app.hours > 0)) {
    showMessage('모든 칸을 채워 주세요. (교육시간은 1 이상)', 'error');
    return;
  }
  if (isDuplicate(apps, app.name, app.course)) {          // R-01
    showMessage(`${app.name} 님은 이미 「${app.course}」에 신청했습니다.`, 'error');
    return;
  }
  if (isFull(apps, courses, app.course)) {                // R-02
    showMessage(`「${app.course}」은 정원이 찼습니다. (마감)`, 'error');
    return;
  }

  try {
    await insertApp(app);
  } catch (e) {
    showMessage('저장하지 못했습니다 : ' + e.message, 'error');
    renderAll(); // 실패해도 저장소 기준으로 다시 그린다
    return;
  }
  $('applyForm').reset();
  showMessage(`${app.name} 님의 「${app.course}」 신청이 등록되었습니다.`, 'ok');
  renderAll();
}

// ---- F-05 상태 변경 ----
async function changeStatus(id, newStatus) {
  const app = apps.find(a => a.id === id);
  if (!app) return;
  if (!canChangeStatus(app.status, newStatus)) {          // R-04
    showMessage(`'${app.status}' 상태는 더 이상 바꿀 수 없습니다.`, 'error');
    return;
  }
  try {
    await updateStatus(id, newStatus);
  } catch (e) {
    showMessage('상태를 바꾸지 못했습니다 : ' + e.message, 'error');
    renderAll(); // 실패해도 저장소 기준으로 다시 그린다
    return;
  }
  showMessage(`${app.name} 님 「${app.course}」 → ${newStatus}`, 'ok');
  renderAll();
}

// ---- F-04 정원 설정 ----
async function setCapacity(course, value) {
  const cap = Number(value);
  if (!(cap >= 1 && cap <= 100)) {
    showMessage('정원은 1~100 사이로 입력해 주세요.', 'error');
    renderSummary();
    return;
  }
  try {
    await updateCapacity(course, cap);
  } catch (e) {
    showMessage('정원을 바꾸지 못했습니다 : ' + e.message, 'error');
    renderAll(); // 실패해도 저장소 기준으로 다시 그린다
    return;
  }
  showMessage(`「${course}」 정원을 ${cap}명으로 바꿨습니다.`, 'ok');
  renderAll();
}

// ---- F-07 CSV 다운로드 ----
function downloadCSV(course) {
  const rows = sortByDate(apps.filter(a => a.course === course));
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `신청명단_${course}_${todayStr()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}


// ---- 화면 그리기 ----
// F-02 신청 목록
function renderList() {
  const body = $('applicationList');
  if (!body) return;
  body.replaceChildren();
  for (const a of sortByDate(apps)) {
    const tr = make('tr');
    tr.append(make('td', a.date), make('td', a.course), make('td', a.hours + '시간'),
      make('td', a.name), make('td', a.team));
    const st = make('td');
    st.append(make('span', a.status, 'badge st-' + a.status));
    tr.append(st);

    const act = make('td');
    for (const next of [STATUS.DONE, STATUS.CANCEL]) {
      const btn = make('button', next, 'small');
      btn.disabled = !canChangeStatus(a.status, next);    // T-06
      btn.addEventListener('click', () => changeStatus(a.id, next));
      act.append(btn);
    }
    tr.append(act);
    body.append(tr);
  }
}

// 과정별 요약 카드 (F-04 마감 배지, F-07 CSV, F-08 D-7 배지)
function renderSummary() {
  const box = $('courseSummary');
  if (!box) return;
  box.replaceChildren();
  const today = todayStr();
  for (const course of courseNames(apps, courses)) {
    const count = activeCount(apps, course);
    const cap = getCapacity(courses, course);
    const date = courseDate(apps, course);
    const card = make('div', undefined, 'course-card');

    const head = make('div', undefined, 'course-head');
    head.append(make('strong', course));
    if (isFull(apps, courses, course)) head.append(make('span', '마감', 'badge full'));
    if (date && isWithin7Days(date, today)) head.append(make('span', 'D-' + daysUntil(date, today), 'badge soon'));
    card.append(head);

    card.append(make('div', date ? '교육일 ' + date : '교육일 미정', 'muted'));
    card.append(make('div', `${count} / ${cap}명`, 'count'));

    const capRow = make('label', '정원 ', 'cap-row');
    const capInput = make('input');
    capInput.type = 'number'; capInput.min = 1; capInput.max = 100; capInput.value = cap;
    capInput.addEventListener('change', () => setCapacity(course, capInput.value));
    capRow.append(capInput);
    card.append(capRow);

    const csv = make('button', '명단 CSV', 'small ghost');
    csv.addEventListener('click', () => downloadCSV(course));
    card.append(csv);
    box.append(card);
  }

  // 신청 폼의 과정 선택 목록
  const options = $('courseOptions');
  if (options) {
    options.replaceChildren(...courseNames(apps, courses).map(c => {
      const o = document.createElement('option'); o.value = c; return o;
    }));
  }
}

// F-06 개인별 올해 누적 이수 시간
function renderHours() {
  const body = $('hoursTable');
  if (!body) return;
  body.replaceChildren();
  const year = todayStr().slice(0, 4);
  for (const row of hoursByPerson(apps, year)) {
    const tr = make('tr');
    tr.append(make('td', row.name), make('td', row.hours + '시간'));
    body.append(tr);
  }
}

function renderAll() {
  renderSummary();
  renderList();
  renderHours();
}

// 이미 있는 과정을 고르면 교육일·시간을 채워 준다
function fillCourseInfo() {
  const course = $('courseInput').value.trim();
  const sample = apps.find(a => a.course === course);
  if (sample) {
    $('dateInput').value = sample.date;
    $('hoursInput').value = sample.hours;
  }
}

// ---- F-10 새로 불러오기 (다른 사람이 등록한 내용 읽어 오기) ----
async function reloadData() {
  const btn = $('reloadBtn');
  if (btn) btn.disabled = true;
  try {
    await loadData();
    showMessage('최신 목록을 불러왔습니다.', 'ok');
  } catch (e) {
    showMessage('데이터를 불러오지 못했습니다 : ' + e.message, 'error');
  }
  if (btn) btn.disabled = false;
  renderAll();
}

document.addEventListener('DOMContentLoaded', async () => {
  $('applyForm').addEventListener('submit', e => { e.preventDefault(); addApplication(); });
  $('courseInput').addEventListener('change', fillCourseInfo);
  const reloadBtn = $('reloadBtn');
  if (reloadBtn) reloadBtn.addEventListener('click', reloadData);
  try {
    await loadData();
  } catch (e) {
    showMessage('데이터를 불러오지 못했습니다 : ' + e.message, 'error');
  }
  renderAll();
});
