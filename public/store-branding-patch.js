(() => {
  const CACHE_KEY = 'storeflow_cached_all_stores';

  const getStores = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const storeName = (s) =>
    s?.business_name ||
    s?.data?.storeName ||
    s?.data?.businessName ||
    s?.data?.profile?.businessName ||
    'Store';

  const logoUrl = (s) => {
    const candidates = [
      s?.logo,
      s?.data?.profile?.logo,
      s?.data?.profile?.profilePhoto,
      s?.data?.profile?.avatar,
      s?.data?.profile?.image,
      s?.data?.logo,
      s?.data?.marketplaceSettings?.logo,
    ];
    return candidates.find(v => typeof v === 'string' && /^(https?:|data:)/i.test(v)) || '';
  };

  const findStore = (visibleName) => {
    const name = String(visibleName || '').trim();
    if (!name) return null;
    return getStores().find(s => {
      const names = [storeName(s), s?.business_name, s?.data?.storeName, s?.data?.businessName]
        .filter(Boolean)
        .map(String);
      return names.includes(name);
    }) || null;
  };

  const applyHomeCards = () => {
    const heading = [...document.querySelectorAll('h2')].find(el => el.textContent?.trim() === 'Your Stores');
    const section = heading?.closest('section');
    if (!section) return;

    const cards = section.querySelectorAll('div.grid > div');
    cards.forEach(card => {
      const title = card.querySelector('h4');
      if (!title) return;

      const store = findStore(title.textContent);
      if (!store) return;

      const canonicalName = storeName(store);
      if (canonicalName) title.textContent = canonicalName;
      title.classList.add('dark:text-zinc-100');
      title.style.color = '';

      const imgBox = card.querySelector('div.w-16.h-16');
      const url = logoUrl(store);
      if (!imgBox || !url) return;

      let img = imgBox.querySelector('img[data-storeflow-brand-logo]');
      if (!img) {
        img = document.createElement('img');
        img.setAttribute('data-storeflow-brand-logo', 'true');
        img.className = 'w-full h-full object-cover';
        img.alt = canonicalName;
        imgBox.replaceChildren(img);
      }
      if (img.src !== url) img.src = url;
      img.onerror = () => { img.style.display = 'none'; };
    });
  };

  const applyStoreProfile = () => {
    const title = [...document.querySelectorAll('h1')].find(el => {
      const text = el.textContent?.trim() || '';
      return text && text !== 'StoreFlow' && !text.includes('Welcome');
    });
    if (!title) return;

    const store = findStore(title.textContent);
    if (!store) return;

    const url = logoUrl(store);
    if (!url) return;

    const mark = document.querySelector('div.absolute.-top-16.w-32.h-32');
    if (!mark) return;

    let img = mark.querySelector('img[data-storeflow-profile-logo]');
    if (!img) {
      img = document.createElement('img');
      img.setAttribute('data-storeflow-profile-logo', 'true');
      img.className = 'w-full h-full object-cover';
      img.alt = storeName(store);
      mark.replaceChildren(img);
    }
    if (img.src !== url) img.src = url;
    img.onerror = () => { img.style.display = 'none'; };
  };

  const apply = () => {
    applyHomeCards();
    applyStoreProfile();
  };

  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('storage', event => {
    if (event.key === CACHE_KEY) apply();
  });

  setTimeout(apply, 250);
  setTimeout(apply, 1000);
  setTimeout(apply, 2500);
})();
