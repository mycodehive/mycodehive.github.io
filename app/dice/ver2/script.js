document.addEventListener("DOMContentLoaded", () => {
  const MAX_DICE = 6;
  const MIN_DICE = 1;
  const FACE_ROTATIONS = {
    1:{x:0,y:0,z:0},
    2:{x:90,y:0,z:0},
    3:{x:0,y:-90,z:0},
    4:{x:0,y:90,z:0},
    5:{x:-90,y:0,z:0},
    6:{x:0,y:180,z:0}
  };
  const PIPS = {
    1:["mc"],
    2:["tl","br"],
    3:["tl","mc","br"],
    4:["tl","tr","bl","br"],
    5:["tl","tr","mc","bl","br"],
    6:["tl","ml","bl","tr","mr","br"]
  };
  const FACE_MAP = [
    ["front",1],["back",6],["right",3],["left",4],["top",2],["bottom",5]
  ];

  const els = {
    container:document.getElementById("diceContainer"),
    stage:document.getElementById("diceStage"),
    sum:document.getElementById("diceSum"),
    count:document.getElementById("diceCount"),
    decrease:document.getElementById("decreaseDice"),
    increase:document.getElementById("increaseDice"),
    roll:document.getElementById("rollButton"),
    headline:document.getElementById("headline"),
    subline:document.getElementById("subline"),
    chips:document.getElementById("resultChips"),
    history:document.getElementById("history"),
    sound:document.getElementById("soundToggle")
  };

  let diceCount = 1;
  let rolling = false;
  let soundOn = true;
  let history = [];
  let audioContext = null;

  function pipMarkup(value){
    return PIPS[value].map((pos,index) =>
      '<span class="pip pos-' + pos + (value === 1 || (value === 5 && index === 2) ? ' accent' : '') + '"></span>'
    ).join("");
  }

  function dieMarkup(index){
    return '<div class="die-slot" data-index="' + index + '">' +
      '<div class="die-shadow"></div>' +
      '<div class="die" role="img" aria-label="주사위">' +
      FACE_MAP.map(([face,value]) =>
        '<div class="face ' + face + '" aria-hidden="true">' + pipMarkup(value) + '</div>'
      ).join("") +
      '</div></div>';
  }

  function renderDice(){
    els.container.innerHTML = Array.from({length:diceCount},(_,i)=>dieMarkup(i)).join("");
    els.count.textContent = diceCount;
    els.decrease.disabled = diceCount <= MIN_DICE;
    els.increase.disabled = diceCount >= MAX_DICE;
    els.sum.textContent = "—";
    els.chips.innerHTML = "";
    els.headline.textContent = "주사위를 굴려보세요";
    els.subline.textContent = "화면을 누르거나 아래 버튼을 눌러 시작하세요.";
  }

  function randomInt(min,max){
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function playRollSound(){
    if(!soundOn) return;
    try{
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioContext.currentTime;
      for(let i=0;i<5;i++){
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(90 + Math.random()*85, now + i*.085);
        gain.gain.setValueAtTime(.0001, now + i*.085);
        gain.gain.exponentialRampToValueAtTime(.055, now + i*.085 + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, now + i*.085 + .07);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + i*.085);
        osc.stop(now + i*.085 + .075);
      }
    }catch{}
  }

  function playLandSound(){
    if(!soundOn || !audioContext) return;
    try{
      const now=audioContext.currentTime;
      const osc=audioContext.createOscillator();
      const gain=audioContext.createGain();
      osc.type="sine";
      osc.frequency.setValueAtTime(72,now);
      osc.frequency.exponentialRampToValueAtTime(42,now+.12);
      gain.gain.setValueAtTime(.08,now);
      gain.gain.exponentialRampToValueAtTime(.0001,now+.14);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now);osc.stop(now+.15);
    }catch{}
  }

  function showResults(results){
    const total = results.reduce((sum,n)=>sum+n,0);
    els.sum.textContent = total;
    els.chips.innerHTML = results.map(n=>'<span class="result-chip">'+n+'</span>').join("");
    els.headline.textContent = results.length === 1 ? "결과는 " + total : "합계 " + total;
    els.subline.textContent = results.join(" + ") + (results.length > 1 ? " = " + total : "");

    history.unshift(total);
    history = history.slice(0,7);
    els.history.innerHTML = history.map(n=>"<span>"+n+"</span>").join("");
  }

  async function rollDice(){
    if(rolling) return;
    rolling = true;
    els.roll.disabled = true;
    els.roll.classList.add("rolling");
    els.sum.textContent = "···";
    els.chips.innerHTML = "";
    els.headline.textContent = "Rolling!";
    els.subline.textContent = "주사위가 굴러가는 중입니다.";
    navigator.vibrate?.([18,24,18]);
    playRollSound();

    const slots = [...els.container.querySelectorAll(".die-slot")];
    const results = slots.map(()=>randomInt(1,6));
    const promises = slots.map((slot,index) => new Promise(resolve => {
      const die = slot.querySelector(".die");
      const value = results[index];
      const target = FACE_ROTATIONS[value];
      const duration = randomInt(920,1320) + index*55;
      const turnsX = randomInt(2,4)*360;
      const turnsY = randomInt(2,5)*360;
      const turnsZ = randomInt(1,3)*360;

      slot.style.setProperty("--roll-duration",duration+"ms");
      die.style.setProperty("--roll-duration",duration+"ms");
      slot.classList.remove("rolling");
      die.classList.remove("rolling");

      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          slot.classList.add("rolling");
          die.classList.add("rolling");
          die.style.transform =
            "rotateX("+(turnsX+target.x)+"deg) " +
            "rotateY("+(turnsY+target.y)+"deg) " +
            "rotateZ("+(turnsZ+target.z)+"deg)";
        });
      });

      setTimeout(()=>{
        die.setAttribute("aria-label","주사위 결과 "+value);
        slot.classList.remove("rolling");
        die.classList.remove("rolling");
        die.style.transition = "none";
        die.style.transform =
          "rotateX("+target.x+"deg) rotateY("+target.y+"deg) rotateZ("+target.z+"deg)";
        requestAnimationFrame(()=>{ die.style.transition = ""; });
        resolve();
      },duration+40);
    }));

    await Promise.all(promises);
    playLandSound();
    navigator.vibrate?.(24);
    showResults(results);
    els.roll.disabled = false;
    els.roll.classList.remove("rolling");
    rolling = false;
  }

  els.increase.addEventListener("click",()=>{
    if(rolling || diceCount>=MAX_DICE) return;
    diceCount++;
    renderDice();
  });

  els.decrease.addEventListener("click",()=>{
    if(rolling || diceCount<=MIN_DICE) return;
    diceCount--;
    renderDice();
  });

  els.roll.addEventListener("click",rollDice);
  els.stage.addEventListener("click",event=>{
    if(event.target.closest("button")) return;
    rollDice();
  });

  els.sound.addEventListener("click",()=>{
    soundOn=!soundOn;
    els.sound.setAttribute("aria-pressed",String(soundOn));
    els.sound.textContent=soundOn?"Sound On":"Sound Off";
  });

  window.addEventListener("keydown",event=>{
    if(event.code==="Space" && !event.repeat && !["INPUT","TEXTAREA","BUTTON"].includes(document.activeElement?.tagName)){
      event.preventDefault();
      rollDice();
    }
  });

  renderDice();
});
