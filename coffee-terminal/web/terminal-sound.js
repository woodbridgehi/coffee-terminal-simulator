/* Terminal defaults are independent of customer-page audio preferences. */
(function(root){
  class TerminalSoundPreferences {
    constructor(sound){this.sound=sound;this.enabled=true;sound.setVolume(1);}
    activate(){if(this.enabled && !this.sound.enabled)return this.sound.enable();return Promise.resolve();}
    toggle(enabled){this.enabled=enabled;if(enabled)return this.activate();this.sound.mute();return Promise.resolve();}
    visibility(visible){if(visible)return this.activate();this.sound.mute();this.sound.disconnect();return Promise.resolve();}
  }
  root.TerminalSoundPreferences=TerminalSoundPreferences;
  const host=root.document?.getElementById('terminal-sound-controls'),sound=root.CoffeeSound;
  if(!host || !sound)return;
  const preferences=new TerminalSoundPreferences(sound);
  host.innerHTML=`<div class="terminal-audio-card"><div class="audio-heading"><span class="audio-mark" aria-hidden="true">♪</span><div><strong data-audio-text="heading"></strong><small class="audio-status" role="status"></small></div></div><label class="audio-option"><span data-audio-text="sound"></span><input id="terminalSoundEnabled" type="checkbox" role="switch" checked><i aria-hidden="true"></i></label><div class="audio-volume"><label for="terminalSoundVolume" data-audio-text="volume"></label><output for="terminalSoundVolume">100%</output><input id="terminalSoundVolume" type="range" min="0" max="100" step="1" value="100"></div><label class="audio-option"><span data-audio-text="voice"></span><input id="terminalSoundVoice" type="checkbox" role="switch"><i aria-hidden="true"></i></label></div>`;
  const enabled=host.querySelector('#terminalSoundEnabled'),volume=host.querySelector('#terminalSoundVolume'),voice=host.querySelector('#terminalSoundVoice');
  function render(){
    const en=document.documentElement.lang.startsWith('en');
    const copy=en?{heading:'Sound settings',sound:'Sound effects',volume:'Volume',voice:'Ready announcement'}:{heading:'声音设置',sound:'制作音效',volume:'音量',voice:'完成语音'};
    host.querySelectorAll('[data-audio-text]').forEach(el=>el.textContent=copy[el.dataset.audioText]);
    enabled.checked=preferences.enabled;voice.checked=sound.voice;
    volume.value=String(Math.round(sound.volume*100));volume.style.setProperty('--level',volume.value+'%');
    host.querySelector('output').textContent=volume.value+'%';
    host.querySelector('.audio-status').textContent=!preferences.enabled?(en?'Muted':'已静音'):sound.enabled?(en?'On':'已开启'):(en?'Starts on interaction':'等待交互启用');
  }
  const activate=()=>{if(!document.hidden)Promise.resolve(preferences.activate()).then(render).catch(render);};
  enabled.onchange=()=>{preferences.toggle(enabled.checked).then(render).catch(render);render();};
  volume.oninput=()=>{sound.setVolume(Number(volume.value)/100);render();};
  voice.onchange=()=>{sound.voice=voice.checked;if(!sound.voice)root.speechSynthesis?.cancel();render();};
  root.addEventListener('coffee-sound-change',render);
  const observer=new MutationObserver(render);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  // Embedded engines may require the first user gesture to resume AudioContext.
  document.addEventListener('pointerdown',activate,{capture:true});document.addEventListener('keydown',activate,{capture:true});
  document.addEventListener('visibilitychange',()=>preferences.visibility(!document.hidden).then(render).catch(render));
  root.addEventListener('pagehide',()=>{observer.disconnect();sound.close();});
  render();activate();
})(globalThis);
