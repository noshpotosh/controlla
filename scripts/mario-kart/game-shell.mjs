export function installGameShell() {
  document.querySelector('.brand').innerHTML = 'controlla<span aria-hidden="true">●</span>';
  const heading = document.createElement('section');
  heading.className = 'party-head';
  heading.innerHTML = '<div><span class="party-eyebrow">HOST SCREEN · DOUBLE DASH</span><h1>Two riders. One kart.</h1><p>Grab your phone, pick your partner, and hit the track.</p></div><div><span class="party-eyebrow">HOW TO PLAY</span><p>Tilt to steer. Hold accelerate. Drift through the corners.</p></div>';
  document.querySelector('.workspace').before(heading);
  const feedback = document.createElement('p');
  feedback.id = 'party-feedback';
  feedback.setAttribute('role', 'status');
  heading.firstElementChild.append(feedback);
  const actions = document.querySelector('.topbar-actions');
  for (const id of ['runButton', 'muteButton']) actions.append(document.getElementById(id));
  document.querySelector('.play-area').setAttribute('aria-label', 'Double Dash game stage');
  document.querySelector('#screen').setAttribute('aria-label', 'Double Dash game screen');
  const note = document.createElement('p');
  note.className = 'party-note';
  note.innerHTML = '<strong>PHONE CONTROLLERS</strong> · Open a player link on your phone. Enable motion, then recenter. Keyboard: Enter to start · X to accelerate · arrows to navigate.';
  document.querySelector('.workspace').after(note);
  document.getElementById('fullscreenButton').textContent = 'Fullscreen';
}

export function finishGameShell() {
  const pairing = document.createElement('details');
  pairing.className = 'party-pairing';
  pairing.innerHTML = '<summary>Connect phones</summary><div class="party-player-links"></div>';
  const links = pairing.querySelector('div');
  document.querySelectorAll('.topbar-actions a').forEach(link => links.append(link));
  document.querySelector('.topbar-actions').append(pairing);
}
