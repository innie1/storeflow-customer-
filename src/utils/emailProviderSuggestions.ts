const PROVIDERS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com'];
const LIST_ID = 'storeflow-email-provider-suggestions';

function isEmailInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'email' || el.getAttribute('inputmode') === 'email');
}

function updateInput(input: HTMLInputElement) {
  input.autocomplete = input.autocomplete || 'email';
  input.inputMode = 'email';
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('list', LIST_ID);
}

function updateSuggestions(input: HTMLInputElement) {
  const value = input.value.trim();
  const at = value.indexOf('@');
  const local = at >= 0 ? value.slice(0, at) : value;
  const domain = at >= 0 ? value.slice(at + 1).toLowerCase() : '';
  const datalist = document.getElementById(LIST_ID) as HTMLDataListElement | null;
  if (!datalist || !local) return;

  const domains = PROVIDERS.filter(p => !domain || p.startsWith(domain));
  datalist.replaceChildren(...domains.map(p => {
    const option = document.createElement('option');
    option.value = `${local}@${p}`;
    return option;
  }));
}

export function installEmailProviderSuggestions() {
  if (typeof document === 'undefined') return () => {};
  if (document.getElementById(LIST_ID)) return () => {};

  const datalist = document.createElement('datalist');
  datalist.id = LIST_ID;
  document.body.appendChild(datalist);

  const enhance = (root: ParentNode) => root.querySelectorAll('input').forEach(input => {
    if (isEmailInput(input)) {
      updateInput(input);
      input.addEventListener('input', () => updateSuggestions(input));
      input.addEventListener('focus', () => updateSuggestions(input));
    }
  });

  enhance(document);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node instanceof Element) {
          if (isEmailInput(node)) {
            updateInput(node);
            node.addEventListener('input', () => updateSuggestions(node));
            node.addEventListener('focus', () => updateSuggestions(node));
          }
          enhance(node);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
