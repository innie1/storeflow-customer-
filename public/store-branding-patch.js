(() => {
  // Safe merchant-branding bridge for the customer app.
  // Intentionally does NOT use MutationObserver or rewrite the whole DOM.
  // It only touches the Your Stores cards and the store-profile identity.
  const CACHE_KEY = 'storeflow_cached_all_stores';

  const getStores = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const isImageUrl = (value) => typeof value === 'string' && /^(https?:|data:)/i.test(value);

  const getName = (store) =>
    store?.business_name ||
    store?.data?.storeName ||
    store?.data?.businessName ||
    store?.data?.profile?.businessName ||
    'Store';

  const getLogoUrl = (store) => {
    const values = [
      store?.logo,
      store?.data?.profile?.logo,
      store?.data?.logo,
      store?.data?.marketplaceSettings?.logo
    ];
    return values.find(isImageUrl) || null;
  };

  const getLogoStyle = (store) => {
    const value =
      store?.data?.profile?.logoStyle ||
      store?.data?.logoStyle ||
      store?.data?.businessTemplate?.logoStyle ||
      (!isImageUrl(store?.logo) ? store?.logo : null) ||
      'minimalist';
    return String(value).toLowerCase();
  };

  const esc = (value) => String(value || '').replace(/[&<>"']/g, '');

  const brandSvg = (name, style) => {
    const safe = esc(name);
    const initial = safe.charAt(0).toUpperCase() || 'S';
    if (style === 'premium') return `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="65" r="42" fill="none" stroke="#D97706" stroke-width="3"/><text x="120" y="80" text-anchor="middle" fill="#D97706" font-family="Arial" font-size="42" font-weight="700">${initial}</text><text x="120" y="135" text-anchor="middle" fill="#D97706" font-family="Arial" font-size="16" font-weight="800">${safe}</text></svg>`;
    if (style === 'modern') return `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="60" r="40" fill="none" stroke="#10B981" stroke-width="4"/><path d="M98 50h44l-5 30h-34z" fill="none" stroke="#10B981" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#0F172A" font-family="Arial" font-size="16" font-weight="800">${safe}</text></svg>`;
    if (style === 'bold') return `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#DC2626"/><text x="120" y="78" text-anchor="middle" fill="#fff" font-family="Arial" font-size="40" font-weight="900">${initial}</text><text x="120" y="135" text-anchor="middle" fill="#1E3A8A" font-family="Arial" font-size="16" font-weight="900">${safe}</text></svg>`;
    if (style === 'professional') return `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="40" fill="none" stroke="#064E3B" stroke-width="4"/><path d="M100 48h40v34h-40z" fill="none" stroke="#064E3B" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#064E3B" font-family="Arial" font-size="16" font-weight="800">${safe}</text></svg>`;
    if (style === 'creative') return `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#EC4899"/><text x="120" y="78" text-anchor="middle" fill="#fff" font-family="Arial" font-size="40" font-weight="900">${initial}</text><text x="120" y="135" text-anchor="middle" fill="#5B21B6" font-family="Arial" font-size="16" font-weight="800">${safe}</text></svg>`;
    return `<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><path d="M96 54h48l-5 30h-38zM96 54l24-25 24 25" fill="none" stroke="#0F172A" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#0F172A" font-family="Arial" font-size="16" font-weight="800">${safe}</text></svg>`;
  };

  const renderBrand = (box, store, round) => {
    if (!box || !store) return;
    const url = getLogoUrl(store);
    const name = getName(store);
    box.replaceChildren();
    box.style.overflow = 'hidden';
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = name;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      if (round) img.style.borderRadius = '9999px';
      img.onerror = () => {
        box.innerHTML = brandSvg(name, getLogoStyle(store));
        box.firstElementChild?.setAttribute('aria-hidden', 'true');
      };
      box.appendChild(img);
    } else {
      box.innerHTML = brandSvg(name, getLogoStyle(store));
    }
  };

  const patch = () => {
    const stores = getStores();
    if (!stores.length) return;

    // Home: Your Stores
    const heading = [...document.querySelectorAll('h2')].find(el => el.textContent?.trim() === 'Your Stores');
    const section = heading?.closest('section');
    if (section) {
      section.querySelectorAll('h4').forEach(title => {
        const name = title.textContent?.trim();
        const store = stores.find(s => getName(s).trim().toLowerCase() === String(name || '').toLowerCase());
        if (!store) return;
        title.textContent = getName(store);
        title.style.color = '#F4F4F5';
        title.style.opacity = '1';
        title.style.visibility = 'visible';
        title.style.fontWeight = '800';
        const card = title.closest('.relative') || title.closest('div');
        const box = card?.querySelector('div.w-16.h-16');
        if (box && !box.dataset.storeflowBrandingApplied) {
          renderBrand(box, store, false);
          box.dataset.storeflowBrandingApplied = 'true';
        }
      });
    }

    // Store profile: real merchant name + the same merchant logo.
    const profileTitle = [...document.querySelectorAll('h1')].find(el => {
      const text = el.textContent?.trim() || '';
      return text && text !== 'StoreFlow' && !text.includes('Welcome');
    });
    if (profileTitle) {
      const store = stores.find(s => getName(s).trim().toLowerCase() === profileTitle.textContent.trim().toLowerCase());
      if (store) {
        profileTitle.textContent = getName(store);
        profileTitle.style.color = '#F4F4F5';
        profileTitle.style.opacity = '1';
        profileTitle.style.visibility = 'visible';
        const mark = document.querySelector('div.absolute.-top-16.w-32.h-32');
        if (mark && !mark.dataset.storeflowBrandingApplied) {
          renderBrand(mark, store, true);
          mark.dataset.storeflowBrandingApplied = 'true';
        }
      }
    }
  };

  // Run only a few times around normal React route/render timing.
  [250, 700, 1500, 3000].forEach(delay => setTimeout(patch, delay));
  window.addEventListener('popstate', () => setTimeout(patch, 150));
})();
