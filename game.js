"use strict";
const $ = id => document.getElementById(id);
const key = "confession24.v1";
const defaults = {master:75,bgm:70,sfx:55,text:22,auto:100,unread:false,shake:true,flash:true};
function read(keyPart, fallback) {
  try { return JSON.parse(localStorage.getItem(key + keyPart)) ?? fallback; }
  catch { return fallback; }
}
function write(keyPart, value) {
  try { localStorage.setItem(key + keyPart,JSON.stringify(value)); }
  catch { toast("브라우저에서 저장 공간을 사용할 수 없습니다."); }
}
let settings = {...defaults,...read(".settings",{})};
let unlocks = read(".unlocks",{end:[],cg:[],routes:[],seen:[]});
let saves = read(".saves",{auto:null,slots:[null,null,null]});
const clone = value => JSON.parse(JSON.stringify(value));
const artPath = id => "art/" + id + ".webp";
const modal = $("modal");
let state, screen, fullLine = "", offset = 0, typing, advanceTimer, sceneTimer, toastTimer;
let auto = false, skip = false, ctrl = false, busy = false, hiddenUI = false;
let track = "", musicFade, audioContext;
const music = Object.fromEntries(["main","sad","crisis"].map(id => {
  const sound = new Audio("music/" + id + "_theme.mp3");
  sound.loop = true;
  sound.preload = "auto";
  return [id,sound];
}));
const volume = () => settings.master * settings.bgm / 10000;
function prepareAudio() {
  if (!audioContext) {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (Constructor) audioContext = new Constructor();
  }
  if (audioContext?.state === "suspended") audioContext.resume().catch(() => {});
}
function bgm(id, hard = false) {
  if (track === id) {
    if (id && music[id].paused) music[id].play().catch(() => {});
    return;
  }
  clearInterval(musicFade);
  const previous = music[track];
  track = id;
  const current = music[id];
  for (const sound of Object.values(music)) {
    if (sound !== current && sound !== previous) sound.pause();
  }
  const outgoing = previous?.volume || 0;
  if (current) {
    current.currentTime = 0;
    current.volume = hard ? volume() : 0;
    current.play().catch(() => {});
  }
  if (hard) {
    previous?.pause();
    return;
  }
  let frame = 0;
  musicFade = setInterval(() => {
    const progress = ++frame / 12;
    if (previous) previous.volume = outgoing * (1-progress);
    if (current) current.volume = volume() * progress;
    if (frame === 12) {
      clearInterval(musicFade);
      previous?.pause();
    }
  },32);
}
function sfx(id) {
  if (!audioContext || audioContext.state !== "running") return;
  const patterns = {
    click:[[670,.09,"sine",0]], message:[[760,.16,"sine",0],[1020,.2,"sine",.1]],
    crash:[[85,.85,"sawtooth",0]], alarm:[[240,.24,"triangle",0],[320,.22,"triangle",.27],[240,.24,"triangle",.54]],
    jump:[[890,.34,"triangle",0]], time:[[310,.18,"sine",0],[490,.25,"triangle",.11],[790,.42,"triangle",.25]],
    bell:[[550,.85,"sine",0],[825,.7,"sine",.21]], end:[[440,.38,"sine",0],[660,.57,"sine",.18]]
  };
  for (const [frequency,length,shape,delay] of patterns[id] || []) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + delay;
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(frequency,start);
    if (id === "crash") oscillator.frequency.exponentialRampToValueAtTime(26,start + length);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.linearRampToValueAtTime(.16 * settings.master * settings.sfx / 10000 + .0001,start + .025);
    gain.gain.exponentialRampToValueAtTime(.0001,start + length);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + length);
  }
}
const palettes = [
  "#c7e8eb,#f0dabd,#d995aa","#e7d0b9,#f8ede5,#d2a5ae","#cde9ef,#b1c5a4,#dfb89c",
  "#e4d7ba,#f5e9d2,#a0b6bb","#c1e6ef,#d6e4df,#a2b8cf","#edd2d9,#eddfca,#c8adc8",
  "#5c354d,#f28b65,#a84950","#f4d2b7,#db96a1,#927394","#d5ac73,#ab6b53,#674b60",
  "#f5b491,#e696a1,#775b99","#b7dce6,#c8c698,#bb866d","#d0bfc2,#8495a5,#7d6484",
  "#2d334f,#6d596f,#a87784","#e7e2ec,#b6aacb,#5f5a82","#e7a589,#ce8094,#574868",
  "#fff3cc,#d6a170,#726580","#49344d,#785465,#bc916a"
];
const preloaded = new Map();
function preload(id) {
  if (id === undefined || preloaded.has(id)) return;
  const img = new Image();
  preloaded.set(id,img);
  img.src = artPath(id);
}
let currentArt = -1;
function setArt(id) {
  const art = $("art");
  art.style.setProperty("--fallback","linear-gradient(145deg," + palettes[id] + ")");
  art.style.backgroundImage = 'url("' + artPath(id) + '"), var(--fallback)';
  art.style.backgroundPosition = id === 0 ? "right center,center" : "center";
  if (currentArt !== id) animate(art,"changed");
  currentArt = id;
}
function animate(node,name) {
  node.classList.remove(name);
  void node.offsetWidth;
  node.classList.add(name);
}
function flash() { if (settings.flash) animate($("fx"),"flash"); }
function shake() { if (settings.shake) animate($("art"),"shake"); }
function setScreen(id) {
  screen = id;
  $("game").dataset.screen = id;
  for (const name of ["title","play","ending"]) $(name).hidden = name !== id;
  $("art").classList.remove("dread","shake");
}
function toast(message) {
  $("toast").textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").textContent = ""; },2200);
}
function button(label, action, className) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  if (className) el.className = className;
  el.addEventListener("click",action);
  return el;
}
function element(tag,text,className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function popup(kind,title,...children) {
  clearTimeout(advanceTimer);
  modal.className = kind === "image" ? "image-view" : "";
  const heading = element("header",null,"dialog-head");
  const label = element("h2",title);
  label.id = "modal-title";
  heading.append(label,button("닫기",() => modal.close()));
  modal.replaceChildren(heading,...children);
  modal.setAttribute("aria-labelledby","modal-title");
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
modal.addEventListener("close",() => {
  schedule();
});
function stopTimers() {
  clearInterval(typing);
  clearTimeout(advanceTimer);
  clearTimeout(sceneTimer);
  busy = false;
}
function stopModes() {
  auto = skip = ctrl = false;
  for (const action of ["auto","skip"]) {
    document.querySelector('[data-action="'+action+'"]').setAttribute("aria-pressed","false");
  }
}
function title() {
  stopTimers();
  stopModes();
  setScreen("title");
  setArt(0);
  $("continue").disabled = !saves.auto && !saves.slots.some(Boolean);
  $("reward").hidden = unlocks.end.length !== Object.keys(ENDS).length;
  bgm("main");
}
function newGame() {
  const form = element("form");
  const label = element("label","주인공 이름");
  label.htmlFor = "player-name";
  const input = element("input");
  Object.assign(input,{id:"player-name",type:"text",maxLength:14,value:"하루토",autocomplete:"off"});
  const submit = element("button","시작","primary");
  form.append(label,input,submit);
  form.addEventListener("submit",event => {
    event.preventDefault();
    prepareAudio();
    modal.close();
    start(input.value.trim() || "하루토");
  });
  popup("new","새 이야기",form);
  input.select();
}
function start(name) {
  setScreen("play");
  setHidden(false);
  state = {version:1,name,id:"start",line:0,path:[],trail:[],bgm:"main",checkpoint:null};
  stopModes();
  bgm("main");
  enter("start");
}
function saveAuto() {
  saves.auto = {...clone(state),date:Date.now()};
  write(".saves",saves);
}
function enter(id) {
  stopTimers();
  if (ENDS[id]) {
    finish(id);
    return;
  }
  state.id = id;
  state.line = 0;
  state.trail.push(id);
  const cue = STORY[id].cue;
  if (cue) state.bgm = ["main","sad"].includes(cue) ? cue : "crisis";
  saveAuto();
  if (cue === "meteor") {
    busy = true;
    bgm("",true);
    $("dialogue").hidden = true;
    sceneTimer = setTimeout(() => {
      if (screen !== "play") return;
      busy = false;
      render(true);
      bgm("crisis",true);
      shake();
    },520);
    return;
  }
  bgm(state.bgm,!!cue && state.bgm === "crisis");
  render(true);
  if (cue === "fleet") { shake(); sfx("alarm"); }
  if (cue === "wedding" || cue === "time") { flash(); sfx(cue === "time" ? "time" : "bell"); }
  if (id === "start" || id === "tomorrow") sfx("message");
}
function speakerName(name) { return name === "@" ? state.name : name; }
function bodyText(text) { return text.replaceAll("{name}",state.name); }
function render(animateText) {
  clearInterval(typing);
  clearTimeout(advanceTimer);
  const scene = STORY[state.id];
  const row = scene.lines[state.line];
  const atChoice = !row;
  setArt(scene.art);
  if (Array.isArray(scene.next)) {
    for (const [,target] of scene.next) preload(STORY[target]?.art);
  } else preload(STORY[scene.next]?.art);
  $("art").classList.toggle("dread",scene.cue === "curry");
  $("scene-label").querySelector("time").textContent = scene.time;
  $("scene-label").querySelector("span").textContent = scene.place;
  if (CG[scene.art] && !unlocks.cg.includes(scene.art)) {
    unlocks.cg.push(scene.art);
    write(".unlocks",unlocks);
  }
  $("choices").replaceChildren();
  $("choices").hidden = !atChoice;
  $("dialogue").hidden = hiddenUI || atChoice;
  $("quick").hidden = hiddenUI;
  if (atChoice) {
    stopModes();
    scene.next.forEach(([label,next],i) => {
      $("choices").append(button(label,() => choose(i,next)));
    });
    $("choices").firstElementChild?.focus({preventScroll:true});
    return;
  }
  const [name,text] = row;
  $("speaker").textContent = speakerName(name);
  $("speaker").hidden = !name;
  fullLine = bodyText(text);
  offset = animateText && settings.text > 0 && !canSkip() ? 0 : fullLine.length;
  drawLine();
  if (offset < fullLine.length) {
    typing = setInterval(() => {
      offset++;
      drawLine();
      if (offset >= fullLine.length) {
        clearInterval(typing);
        schedule();
      }
    },settings.text);
  }
  schedule();
}
function drawLine() {
  $("line").textContent = fullLine.slice(0,offset);
  $("next").hidden = offset < fullLine.length;
}
function lineKey() { return state.id + ":" + state.line; }
function canSkip() { return (skip || ctrl) && (settings.unread || unlocks.seen.includes(lineKey())); }
function schedule() {
  clearTimeout(advanceTimer);
  if (screen !== "play" || hiddenUI || modal.open || busy || !$("choices").hidden) return;
  if (canSkip()) advanceTimer = setTimeout(advance,55);
  else if (auto && offset >= fullLine.length) {
    advanceTimer = setTimeout(advance,Math.max(800,1100 + fullLine.length * 35) * 100 / settings.auto);
  }
}
function advance() {
  if (screen !== "play" || modal.open || busy || hiddenUI || !$("choices").hidden) return;
  if (offset < fullLine.length && !canSkip()) {
    clearInterval(typing);
    offset = fullLine.length;
    drawLine();
    schedule();
    return;
  }
  if (!unlocks.seen.includes(lineKey())) {
    unlocks.seen.push(lineKey());
    write(".unlocks",unlocks);
  }
  const scene = STORY[state.id];
  if (state.line + 1 < scene.lines.length) {
    state.line++;
    render(true);
  } else if (Array.isArray(scene.next)) {
    state.line++;
    saveAuto();
    render(false);
  } else enter(scene.next);
}
function choose(index,next) {
  if ($("choices").hidden || busy || modal.open) return;
  const {checkpoint,...snapshot} = state;
  state.checkpoint = clone(snapshot);
  state.path.push(index === 0 ? "A" : "B");
  sfx("click");
  enter(next);
}
function finish(id) {
  const [name,type,art,results,quote] = ENDS[id];
  if (!unlocks.end.includes(id)) { unlocks.end.push(id); sfx("end"); }
  const route = state.path.join("-");
  if (!unlocks.routes.includes(route)) unlocks.routes.push(route);
  write(".unlocks",unlocks);
  stopModes();
  setScreen("ending");
  setArt(art);
  if (id === "E01") { flash(); sfx("crash"); }
  if (id === "E03") flash();
  bgm(id === "E05" ? "main" : "");
  const card = element("article",null,"end-card");
  const actions = element("div",null,"actions");
  actions.append(button("직전 선택지로",() => restore(state.checkpoint)),button("처음부터",newGame),
    button("엔딩 컬렉션",collection),button("타이틀 화면",title));
  card.append(element("div","ENDING "+id.slice(1)+" · "+type,"end-id"),element("h2",name),
    ...results.map(result => element("p",result)),element("blockquote","“"+quote+"”"),actions);
  $("ending").replaceChildren(card);
  actions.firstElementChild.focus({preventScroll:true});
}
function restore(snapshot) {
  if (!snapshot || !STORY[snapshot.id] || snapshot.version !== 1) return;
  prepareAudio();
  if (modal.open) modal.close();
  stopTimers();
  stopModes();
  state = clone(snapshot);
  state.checkpoint ??= null;
  setScreen("play");
  setHidden(false);
  bgm(state.bgm);
  render(false);
  saveAuto();
}
function setHidden(value) {
  hiddenUI = value;
  $("show-ui").hidden = !value;
  $("dialogue").hidden = value || !$("choices").hidden;
  $("quick").hidden = value;
  schedule();
}
function slots(saving) {
  const list = element("div",null,"slot-list");
  if (!saving && saves.auto) list.append(button("자동 저장 · " + slotLabel(saves.auto),() => restore(saves.auto)));
  saves.slots.forEach((slot,index) => {
    const entry = button("슬롯 "+(index+1)+" · "+(slot ? slotLabel(slot) : "비어 있음"),() => {
      if (!saving) { restore(slot); return; }
      const commit = () => {
        saves.slots[index] = {...clone(state),date:Date.now()};
        write(".saves",saves);
        modal.close();
        toast("슬롯 "+(index+1)+"에 저장했습니다.");
      };
      if (slot) popup("overwrite","저장 덮어쓰기",element("p","이 슬롯의 진행 기록을 교체할까요?"),
        button("덮어쓰기",commit,"primary"),button("뒤로",() => slots(true)));
      else commit();
    });
    entry.disabled = !saving && !slot;
    list.append(entry);
  });
  popup(saving ? "save" : "load",saving ? "저장" : "불러오기",list);
}
function slotLabel(slot) {
  return STORY[slot.id].place+" / "+slot.name+" / "+new Date(slot.date).toLocaleString("ko-KR");
}
function collection() {
  const cards = element("div",null,"cards");
  for (const [id,[name,type,art,results,quote]] of Object.entries(ENDS)) {
    const number = "ENDING "+id.slice(1);
    if (!unlocks.end.includes(id)) {
      const card = element("div",null,"card lock");
      card.append(element("small",number),element("span","🔒 ????????"));
      cards.append(card);
      continue;
    }
    const card = button("",() => popup("end-details",name,artImage(art,name),
      ...results.map(result => element("p",result)),element("p","“"+quote+"”"),button("목록으로",collection)),"card");
    card.append(artImage(art,""),element("small",number+" · "+type),element("span",name));
    cards.append(card);
  }
  popup("collection","엔딩 컬렉션",element("p",unlocks.end.length+" / 5 발견 · "+unlocks.routes.length+" / 6 경로 완주"),cards);
}
function artImage(id,name) {
  const img = element("img");
  img.src = artPath(id);
  img.alt = name;
  img.style.maxWidth = "100%";
  img.addEventListener("error",() => { img.hidden = true; });
  return img;
}
function gallery() {
  const cards = element("div",null,"cards");
  for (const [id,name] of Object.entries(CG)) {
    if (!unlocks.cg.includes(Number(id))) {
      const card = element("div",null,"card lock");
      card.append(element("span","🔒 미감상 CG"));
      cards.append(card);
      continue;
    }
    const card = button("",() => viewImage(id,name),"card");
    card.append(artImage(id,""),element("span",name));
    cards.append(card);
  }
  popup("gallery","CG 갤러리",element("p",unlocks.cg.length+" / "+Object.keys(CG).length+" 감상"),cards);
}
function viewImage(id,name) {
  const img = artImage(id,name);
  const toggle = () => {
    const header = modal.querySelector(".dialog-head");
    header.hidden = !header.hidden;
    footer.hidden = header.hidden;
    img.classList.toggle("image-only",header.hidden);
  };
  const footer = element("div",null,"actions");
  footer.append(button("UI 숨기기",toggle),button("목록으로",gallery));
  img.addEventListener("click",toggle);
  popup("image",name,img,footer);
}
function log() {
  const list = element("ul",null,"log");
  for (let i = 0; i < state.trail.length; i++) {
    const {lines} = STORY[state.trail[i]];
    const count = i === state.trail.length-1 ? state.line+1 : lines.length;
    for (const [name,text] of lines.slice(0,count)) {
      const row = element("li");
      if (name) row.append(element("b",speakerName(name)));
      row.append(document.createTextNode(bodyText(text)));
      list.append(row);
    }
  }
  popup("log","대화 기록",list);
  modal.scrollTop = modal.scrollHeight;
}
function config() {
  const controls = [
    ["master","전체 음량",0,100],["bgm","배경 음악",0,100],["sfx","효과음",0,100],
    ["text","글자 출력 간격 (ms)",0,65],["auto","자동 진행 속도 (%)",50,200],
    ["unread","읽지 않은 대사도 스킵"],["shake","화면 진동"],["flash","백색 플래시"]
  ].map(([id,name,min,max]) => {
    const label = element("label",name,"setting");
    const input = element("input");
    const numeric = min !== undefined;
    if (numeric) Object.assign(input,{type:"range",min,max,value:settings[id]});
    else Object.assign(input,{type:"checkbox",checked:settings[id]});
    input.addEventListener("input",() => {
      settings[id] = numeric ? Number(input.value) : input.checked;
      write(".settings",settings);
      if (track && (id === "master" || id === "bgm")) music[track].volume = volume();
    });
    label.append(input);
    return label;
  });
  const actions = element("div",null,"actions");
  actions.append(button("전체 화면 전환",async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { actions.append(element("span","이 브라우저에서는 전체 화면을 사용할 수 없습니다.")); }
  }),button("진행 데이터 초기화",() => popup("reset","진행 데이터 초기화",
    element("p","자동 저장, 세이브 슬롯, 엔딩과 CG 기록을 모두 지울까요?"),
    button("초기화",() => {
      unlocks = {end:[],cg:[],routes:[],seen:[]};
      saves = {auto:null,slots:[null,null,null]};
      write(".unlocks",unlocks);
      write(".saves",saves);
      modal.close();
      title();
    }),button("취소",config))));
  popup("settings","설정",...controls,actions);
}
const actions = {
  new:newGame, continue:() => saves.auto ? restore(saves.auto) : slots(false),
  collection,gallery,settings:config,save:() => { if (!busy) slots(true); },load:() => slots(false),log,
  auto:() => {
    if (!$("choices").hidden) return;
    auto = !auto; skip = false;
    document.querySelector('[data-action="auto"]').setAttribute("aria-pressed",auto);
    document.querySelector('[data-action="skip"]').setAttribute("aria-pressed",false);
    schedule();
  },
  skip:() => {
    if (!$("choices").hidden) return;
    skip = !skip; auto = false;
    document.querySelector('[data-action="skip"]').setAttribute("aria-pressed",skip);
    document.querySelector('[data-action="auto"]').setAttribute("aria-pressed",false);
    if (skip && !canSkip()) toast("읽지 않은 대사에서 대기합니다.");
    schedule();
  },
  hide:() => { if ($("choices").hidden && !busy) setHidden(true); },
  title:() => popup("title-confirm","타이틀로 돌아갈까요?",
    element("p","장면 시작과 선택지에서 진행 상황이 자동 저장됩니다."),
    button("타이틀로",() => { modal.close(); title(); }),button("계속 플레이",() => modal.close())),
  credits:() => popup("credits","제작진",element("p","원안 · 제공 기획서"),element("p","음악 · 제공된 Suno 테마 3곡"),
    element("p","시나리오 각색 · 아트 · HTML5 구현 / Codex"),
    element("p","클릭 또는 Enter / Space로 진행 · Ctrl을 눌러 읽은 대사 스킵 · Esc로 메뉴"))
};
document.addEventListener("click",event => {
  prepareAudio();
  if (track && music[track].paused) music[track].play().catch(() => {});
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) {
    sfx("click");
    actions[action]();
  }
},true);
$("advance").addEventListener("click",() => hiddenUI ? setHidden(false) : advance());
$("show-ui").addEventListener("click",() => setHidden(false));
document.addEventListener("keydown",event => {
  if (event.repeat || screen !== "play" || modal.open) return;
  if (event.key === "Escape") {
    if (hiddenUI) setHidden(false);
    else config();
  }
  if (event.key === "Control" && $("choices").hidden) { ctrl = true; schedule(); }
  if ((event.key === "Enter" || event.code === "Space") &&
      (event.target.id === "advance" || !event.target.closest("button,input"))) {
    event.preventDefault();
    advance();
  }
});
function releaseSkip() { ctrl = false; schedule(); }
document.addEventListener("keyup",event => { if (event.key === "Control") releaseSkip(); });
window.addEventListener("blur",releaseSkip);
setScreen("title");
setArt(0);
preload(STORY.start.art);
$("continue").disabled = !saves.auto && !saves.slots.some(Boolean);
$("reward").hidden = unlocks.end.length < 5;
document.addEventListener("click",() => { if (!state) bgm("main"); },{once:true});
