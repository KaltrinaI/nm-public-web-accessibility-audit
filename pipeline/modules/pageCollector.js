const { AxePuppeteer } = require('@axe-core/puppeteer');

async function collectPageData(page, url) {
  console.log(`    📦 Collecting page data...`);

  let thumbnail = null;
  try {
    thumbnail = await page.screenshot({ encoding: 'base64', fullPage: false });
  } catch (err) {
    console.warn(`    ⚠️  Screenshot failed: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 2000));

  let axeResults = {
    violations:   [],
    passes:       [],
    incomplete:   [],
    inapplicable: [],
  };
  try {
    axeResults = await new AxePuppeteer(page).analyze();
  } catch (err) {
    console.warn(`    ⚠️  axe-core failed: ${err.message?.slice(0, 100)}`);
    axeResults._error = err.message?.slice(0, 200);
  }

  let dom = null;
  try {
    dom = await page.evaluate(() => {
      const images = [...document.querySelectorAll('img')].map(img => {
        const width  = img.naturalWidth  || img.offsetWidth  || img.width  || 0;
        const height = img.naturalHeight || img.offsetHeight || img.height || 0;
        return {
          src:    img.getAttribute('src') || '',
          alt:    img.getAttribute('alt') ?? null,
          title:  img.title || null,
          width,
          height,
          context: (
            img.closest('figure')?.querySelector('figcaption')?.innerText ||
            img.closest('a')?.getAttribute('aria-label') ||
            img.closest('a')?.innerText?.trim() ||
            img.closest('p,li,td')?.innerText?.slice(0, 200) ||
            ''
          ).trim(),
          isInLink: !!img.closest('a'),
          role:     img.getAttribute('role')    || null,
          loading:  img.getAttribute('loading') || null,
        };
      });

      const links = [...document.querySelectorAll('a[href]')].map(a => ({
        text:         a.innerText.trim(),
        href:         a.href,
        ariaLabel:    a.getAttribute('aria-label') || null,
        title:        a.title || null,
        context:      a.closest('p,li,nav,article')?.innerText?.slice(0, 200)?.trim() || '',
        isNavigation: !!a.closest('nav'),
        hasImage:     !!a.querySelector('img'),
        openNewTab:   a.target === '_blank',
      }));

      const forms = [...document.querySelectorAll('form')].map(form => ({
        action: form.action || null,
        method: form.method || 'get',
        inputs: [...form.querySelectorAll('input,select,textarea')].map(el => {
          const labelEl = el.labels?.[0] || document.querySelector(`label[for="${el.id}"]`);
          return {
            type:            el.type || el.tagName.toLowerCase(),
            name:            el.name || null,
            id:              el.id   || null,
            labelText:       labelEl?.innerText?.trim() || null,
            placeholder:     el.placeholder || null,
            required:        el.required,
            ariaLabel:       el.getAttribute('aria-label')       || null,
            ariaDescribedBy: el.getAttribute('aria-describedby') || null,
            autocomplete:    el.getAttribute('autocomplete')     || null,
            value: el.tagName === 'SELECT'
              ? [...el.options].map(o => o.text).join(', ')
              : null,
          };
        }),
        errorMessages: [...form.querySelectorAll(
          '[role="alert"], .error, .error-message, [aria-live]'
        )].map(el => el.innerText.trim()).filter(Boolean),
      }));

      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({
        level:   parseInt(h.tagName.replace('H', '')),
        text:    h.innerText.trim(),
        id:      h.id || null,
        context: h.nextElementSibling?.innerText?.slice(0, 200) || '',
      }));

      const buttons = [...document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"]'
      )].map(btn => ({
        text:       btn.innerText?.trim() || btn.value || '',
        ariaLabel:  btn.getAttribute('aria-label') || null,
        type:       btn.type || btn.getAttribute('type') || null,
        context:    btn.closest('form,dialog,section,nav')
                      ?.querySelector('h1,h2,h3,legend')?.innerText?.trim() || '',
        isDisabled: btn.disabled,
        hasIcon:    !!btn.querySelector('svg,img,i'),
      }));

      const tables = [...document.querySelectorAll('table')].map(table => ({
        caption:  table.querySelector('caption')?.innerText?.trim() || null,
        summary:  table.getAttribute('summary') || null,
        headers:  [...table.querySelectorAll('th')].map(th => ({
          text:  th.innerText.trim(),
          scope: th.getAttribute('scope') || null,
          abbr:  th.getAttribute('abbr')  || null,
        })),
        rowCount:   table.rows.length,
        sampleData: [...table.querySelectorAll('td')].slice(0, 6).map(td => td.innerText.trim()),
      }));

      const langAttribute = document.documentElement.getAttribute('lang') || null;

      const langLinks = [...document.querySelectorAll('a, button')].filter(el => {
        const text = (el.innerText || '').trim().toLowerCase();
        const href = el.href || '';
        return (
          text.match(/albanian|shqip|shqiptar|\bsq\b|\bal\b|ballina|мкд|македонски|\bmk\b|english|\ben\b/i) ||
          href.match(/\/sq\/|\/al\/|\/mk\/|\/en\/|lang=|language=|locale=/i) ||
          el.getAttribute('hreflang') ||
          el.closest('[class*="lang"], [id*="lang"], [class*="language"], [class*="translate"]')
        );
      }).map(el => ({
        text:      (el.innerText || '').trim(),
        href:      el.href   || null,
        hreflang:  el.getAttribute('hreflang')   || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        classes:   typeof el.className === 'string' ? el.className : '',
      }));

      const hreflangTags = [...document.querySelectorAll('link[hreflang], [hreflang]')].map(el => ({
        hreflang: el.getAttribute('hreflang'),
        href:     el.href || el.getAttribute('href'),
      }));

      const meta = {
        title:           document.title,
        lang:            langAttribute,
        metaDescription: document.querySelector('meta[name="description"]')?.content || null,
        ogTitle:         document.querySelector('meta[property="og:title"]')?.content || null,
        viewport:        document.querySelector('meta[name="viewport"]')?.content || null,
        charset:         document.querySelector('meta[charset]')?.getAttribute('charset') || null,
      };

      const bodyText = document.body.innerText
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000);

      const inlineLangElements = [...document.querySelectorAll('[lang]')].map(el => ({
        lang: el.getAttribute('lang'),
        tag:  el.tagName.toLowerCase(),
        text: el.innerText.trim().slice(0, 100),
      }));

      return {
        images, links, forms, headings, buttons,
        tables, meta, bodyText, langLinks,
        hreflangTags, inlineLangElements, langAttribute,
        url: window.location.href,
      };
    });
  } catch (err) {
    console.warn(`    ⚠️  DOM extraction failed: ${err.message?.slice(0, 100)}`);

    dom = {
      images:            [],
      links:             [],
      forms:             [],
      headings:          [],
      buttons:           [],
      tables:            [],
      langLinks:         [],
      hreflangTags:      [],
      inlineLangElements:[],
      langAttribute:     null,
      meta: {
        title: '', lang: null, metaDescription: null,
        ogTitle: null, viewport: null, charset: null,
      },
      bodyText: '',
      url,
      _error: err.message?.slice(0, 200),
    };
  }

  return {
    url,
    dom,
    thumbnail,
    axeResults,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { collectPageData };
