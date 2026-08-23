(() => {
  const PROFILE_CLASSES = ['profile-americano', 'profile-espresso', 'profile-iced-latte', 'profile-hazelnut-special', 'profile-generic'];
  const CUE_CLASSES = ['cue-cup-arrive', 'cue-ice-drop', 'cue-brew-stream', 'cue-water-pour', 'cue-milk-pour', 'cue-syrup-swirl', 'cue-seal', 'cue-serve', 'cue-idle'];
  const SHAPES = {
    tall: {
      shell: 'M88 78 L104 258 Q108 285 134 289 H226 Q252 285 256 258 L272 78 Z',
      clip: 'M92 78 L108 254 Q111 278 136 282 H224 Q249 278 252 254 L268 78 Z',
      rim: 'M88 78 Q180 60 272 78 Q180 96 88 78 Z',
      handle: 'M256 137 C315 125 315 232 251 219',
    },
    mug: {
      shell: 'M105 103 L116 249 Q119 275 143 279 H224 Q248 275 251 249 L261 103 Z',
      clip: 'M110 103 L121 246 Q124 268 145 272 H222 Q243 268 246 246 L256 103 Z',
      rim: 'M105 103 Q183 86 261 103 Q183 120 105 103 Z',
      handle: 'M250 142 C309 126 313 231 247 218',
    },
    espresso: {
      shell: 'M121 135 L130 232 Q133 258 154 263 H210 Q231 258 234 232 L243 135 Z',
      clip: 'M126 135 L135 229 Q138 251 157 256 H207 Q226 251 229 229 L238 135 Z',
      rim: 'M121 135 Q182 120 243 135 Q182 151 121 135 Z',
      handle: 'M231 161 C277 146 283 218 233 214',
    },
  };

  let activeKey = '';
  let animations = [];

  function stopAnimations(stage) {
    for (const animation of animations) {
      if (typeof animation.pause === 'function') animation.pause();
    }
    animations = [];
    stage.querySelectorAll('.drink-visual, .drink-visual *').forEach((element) => {
      ['transform', 'opacity', 'stroke-dashoffset'].forEach((property) => element.style.removeProperty(property));
    });
  }

  function inferProfile(recipe) {
    const configured = recipe?.visual?.profile;
    if (configured) return configured;
    const identity = `${recipe?.recipeId || ''} ${recipe?.name || ''}`.toLowerCase();
    if (identity.includes('iced-latte') || identity.includes('冰拿铁')) return 'iced-latte';
    if (identity.includes('americano') || identity.includes('美式')) return 'americano';
    if (identity.includes('espresso') || identity.includes('浓缩')) return 'espresso';
    if (identity.includes('hazelnut') || identity.includes('榛果') || identity.includes('special') || identity.includes('特调')) return 'hazelnut-special';
    return 'generic';
  }

  function inferCue(step) {
    if (step?.animationCue) return step.animationCue;
    const identity = `${step?.id || ''} ${step?.name || ''}`.toLowerCase();
    if (identity.includes('prepare') || identity.includes('cup') || identity.includes('杯子')) return 'cup-arrive';
    if (identity.includes('ice') || identity.includes('冰')) return 'ice-drop';
    if (identity.includes('milk') || identity.includes('牛奶')) return 'milk-pour';
    if (identity.includes('water') || identity.includes('热水')) return 'water-pour';
    if (identity.includes('syrup') || identity.includes('hazelnut') || identity.includes('糖浆') || identity.includes('榛果')) return 'syrup-swirl';
    if (identity.includes('extract') || identity.includes('brew') || identity.includes('萃取')) return 'brew-stream';
    if (identity.includes('seal') || identity.includes('lid') || identity.includes('封杯') || identity.includes('杯盖')) return 'seal';
    if (identity.includes('serve') || identity.includes('output') || identity.includes('取杯口')) return 'serve';
    return 'idle';
  }

  function applyShape(stage, profile) {
    const shape = profile === 'espresso' ? SHAPES.espresso : profile === 'americano' ? SHAPES.mug : SHAPES.tall;
    stage.querySelector('#cupShell').setAttribute('d', shape.shell);
    stage.querySelector('#drinkClipPath').setAttribute('d', shape.clip);
    stage.querySelector('#cupRim').setAttribute('d', shape.rim);
    stage.querySelector('#cupHandle').setAttribute('d', shape.handle);
  }

  function play(targets, parameters) {
    if (!window.anime?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animations.push(window.anime.animate(targets, parameters));
  }

  function animateCue(stage, cue) {
    const svg = stage.querySelector('.drink-visual');
    const contents = stage.querySelector('.drink-contents');
    if (cue === 'cup-arrive') {
      play(svg, { translateY: [38, 7], opacity: [0, 1], duration: 900, ease: 'out(4)' });
    } else if (cue === 'ice-drop') {
      play(stage.querySelectorAll('.ice-cube'), { translateY: [-58, 0], rotate: [-18, 0], opacity: [0, 1], delay: window.anime.stagger(130), duration: 850, ease: 'outBounce' });
      play(contents, { translateY: [3, 0], duration: 480, delay: 620, ease: 'out(3)' });
    } else if (cue === 'brew-stream') {
      play('#brewStream', { scaleY: [.08, 1], opacity: [.35, 1], duration: 760, loop: true, alternate: true, ease: 'inOutSine' });
      play('.liquid-top', { translateY: [7, 0], duration: 1100, loop: true, alternate: true, ease: 'inOutSine' });
    } else if (cue === 'milk-pour') {
      play('#milkStream', { scaleY: [.1, 1], opacity: [.3, 1], duration: 880, loop: true, alternate: true, ease: 'inOutSine' });
      play('.liquid-base', { translateY: [10, 0], duration: 1300, loop: true, alternate: true, ease: 'inOutSine' });
    } else if (cue === 'water-pour') {
      play('#waterStream', { scaleY: [.1, 1], opacity: [.28, .9], duration: 820, loop: true, alternate: true, ease: 'inOutSine' });
      play(contents, { translateY: [6, 0], duration: 1200, loop: true, alternate: true, ease: 'inOutSine' });
    } else if (cue === 'syrup-swirl') {
      const ribbon = stage.querySelector('.syrup-ribbon');
      const length = ribbon.getTotalLength();
      ribbon.style.strokeDasharray = `${length}`;
      play(ribbon, { strokeDashoffset: [length, 0], opacity: [.25, .95], duration: 1500, loop: true, alternate: true, ease: 'inOutQuad' });
    } else if (cue === 'seal') {
      play('.lid-group', { translateY: [-42, 0], opacity: [0, 1], duration: 900, ease: 'outBounce' });
    } else if (cue === 'serve') {
      play(svg, { translateX: [-18, 18], duration: 1200, loop: true, alternate: true, ease: 'inOutSine' });
      play('.serve-sparkles', { scale: [.75, 1.08], opacity: [.2, 1], duration: 720, loop: true, alternate: true, ease: 'inOutSine' });
    } else {
      play(svg, { translateY: [7, 2], duration: 1800, loop: true, alternate: true, ease: 'inOutSine' });
    }
    if (['americano', 'espresso'].includes(inferProfile({ visual: { profile: stage.dataset.profile } }))) {
      play('.aroma', { translateY: [8, -10], opacity: [.1, .56], delay: window.anime.stagger(180), duration: 1700, loop: true, alternate: true, ease: 'inOutSine' });
    }
  }

  function render(task) {
    const stage = document.querySelector('#coffeeStage');
    if (!stage || !task?.recipe?.steps?.length) return;
    const step = task.recipe.steps[task.stepIndex];
    const profile = inferProfile(task.recipe);
    const cue = inferCue(step);
    const key = `${task.taskId}:${task.stepIndex}:${profile}:${cue}`;
    if (key === activeKey) return;
    activeKey = key;
    stopAnimations(stage);
    stage.classList.remove(...PROFILE_CLASSES, ...CUE_CLASSES);
    stage.classList.add(`profile-${profile}`, `cue-${cue}`);
    stage.dataset.profile = profile;
    stage.dataset.cue = cue;
    applyShape(stage, profile);
    animateCue(stage, cue);
  }

  function reset() {
    const stage = document.querySelector('#coffeeStage');
    if (stage) stopAnimations(stage);
    activeKey = '';
  }

  window.DrinkVisual = { render, reset, inferProfile, inferCue };
})();
