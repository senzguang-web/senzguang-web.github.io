const toggle = document.querySelector('[data-menu-toggle]');
const nav = document.querySelector('[data-nav]');
function closeMenu() {
  toggle?.setAttribute('aria-expanded', 'false');
  if (toggle) toggle.textContent = '目录';
  nav?.classList.remove('is-open');
}
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? '关闭目录' : '目录';
  nav?.classList.toggle('is-open', open);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    toggle.focus();
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.site-header')) closeMenu();
});
nav?.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});

document.querySelectorAll('.unknown-question').forEach(details => {
  details.addEventListener('toggle', () => {
    const label = details.querySelector('.question-toggle');
    if (label) label.textContent = details.open ? '收起问题' : '展开问题';
  });
});

document.querySelectorAll('[data-copy-email]').forEach(button => {
  button.addEventListener('click', async () => {
    const message = document.querySelector('[data-contact-status]');
    try {
      await navigator.clipboard.writeText('z.g.s@cau.edu.cn');
      if (message) message.textContent = '邮箱已复制';
    } catch {
      if (message) message.textContent = '请直接选中邮箱地址复制，或点击它发送邮件。';
    }
  });
});

const share = document.querySelector('[data-copy-link]');
share?.addEventListener('click', async () => {
  const message = document.querySelector('[data-share-status]');
  try {
    await navigator.clipboard.writeText(window.location.href);
    if (message) message.textContent = '链接已复制';
  } catch {
    if (message) message.textContent = '请复制浏览器地址栏中的链接。';
  }
});

// Keep previously shared local anchors useful after the multi-page redesign.
if (document.body.dataset.page === 'home') {
  const legacy = {
    '#work': 'field.html', '#results': 'field.html',
    '#approach': 'field.html#approach', '#about': 'about.html',
    '#contact': 'about.html#contact', '#notes': 'notes.html'
  };
  if (legacy[window.location.hash]) window.location.replace(legacy[window.location.hash]);
}
