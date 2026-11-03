import json, glob, os, re, sys, collections, csv
from scipy.stats import binomtest, wilcoxon
from statsmodels.stats.contingency_tables import mcnemar

D = sys.argv[1]; OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

# category of each site (from filename)
CAT = {}
for k in ['ukim_edu_mk','www_ugd_edu_mk','unite_edu_mk','www_seeu_edu_mk','iust_edu_mk','uklo_edu_mk']: CAT[k]='University'
for k in ['skopjebus_mk','tetovatransport_mk']: CAT[k]='Transport'
for k in ['skopje_gov_mk','www_centar_gov_mk','gradsko_gov_mk','www_bitola_gov_mk','stip_gov_mk','ohrid_gov_mk','karpos_gov_mk','gostivari_gov_mk','tetovo_gov_mk','www_struga_gov_mk','cair_gov_mk','zhelina_gov_mk','saraj_gov_mk','www_haracina_gov_mk','studenicani_gov_mk']: CAT[k]='Municipality'
for k in ['av_gov_mk','finance_gov_mk','investnorthmacedonia_gov_mk','mfa_gov_mk','mon_gov_mk','mtc_gov_mk','mtsp_gov_mk','vlada_mk','www_economy_gov_mk','www_moepp_gov_mk','www_nbrm_mk','zdravstvo_gov_mk']: CAT[k]='Central gov.'

# ---------- objective (deterministic) pattern rules ----------
EXT = re.compile(r'\.(jpe?g|png|gif|webp|svg|bmp|tiff?)$', re.I)
CAMERA = re.compile(r'^(dji|dsc|dscf|img|pxl|p)[_\-]?\d{3,}', re.I)
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
FBID = re.compile(r'^\d+(_\d+){2,}_[a-z]$', re.I)
AITOOL = re.compile(r'^chatgpt image', re.I)
SIZE = re.compile(r'-\d{2,4}x\d{2,4}$')
URLISH = re.compile(r'^(https?://|www\.)|\.(mk|com|org|eu|net|gov)(/|$)', re.I)
def is_slug(a):
    # single token, no whitespace, built from alnum joined by - or _ , or alnum ending in digits
    if re.search(r'\s', a) or URLISH.search(a): return False
    if len(a) < 4: return False
    if re.fullmatch(r'[A-Za-z0-9]+([_\-][A-Za-z0-9]+)+', a): return True
    if re.fullmatch(r'[a-z]+\d+', a): return True       # e.g. ace1, rectorsforum11
    return False
PLACEHOLDER = re.compile(r'^(lorem ipsum.*|null|undefined|none|loading|image|img|photo|picture|graphic|banner|icon|logo|main logo|logo white|counter backgorund|слика( \d+)?|фото|image \d+|picture \d+|\d{1,3})$', re.I)

def img_rule(alt):
    a = ' '.join(alt.split())
    if EXT.search(a) or CAMERA.search(a) or UUID.match(a) or FBID.match(a) or AITOOL.search(a) or SIZE.search(a):
        return 'F30-filename'
    if PLACEHOLDER.match(a): return 'F30-placeholder'
    if is_slug(a): return 'F30-filename'
    return None

GENERIC = [
 'open link here','read more','more','learn more','click here','here','view details','details','see more','see all',
 'прочитај повеќе','прочитајте повеќе','повеќе','дознај повеќе','види повеќе','детално','опширно','овде','тука','кликни тука','види ги сите','повеќе информации',
 'lexo më tepër','lexo më shumë','lexo me shume','kliko për më tepër','më shumë','më tepër','këtu','kliko këtu','shiko më shumë','lexo',
]
GEN = set(GENERIC)
SYMBOL = re.compile(r'^[\+\-»«›‹>→←<…\.\|•·]+$')
def link_rule(text):
    t = ' '.join(text.split()).strip().lower().rstrip('.:!»›>→ ').strip()
    if t == '': return None
    if t == 'open link here': return 'F84-template'
    if t in GEN: return 'F84-generic'
    if SYMBOL.match(' '.join(text.split()).strip()): return 'F84-symbol'
    return None

def base(s): return (s or '').split('?')[0].split('#')[0].rstrip('/').split('/')[-1]

IMG_RULES = {'image-alt','role-img-alt','image-redundant-alt','link-name'}
rows_img=[]; rows_lnk=[]; site_rows=[]
for f in sorted(glob.glob(os.path.join(D,'*.json'))):
    key = os.path.basename(f)[:-5]
    j = json.load(open(f)); h = j['homepage']; m = h['modules']
    vnodes = collections.defaultdict(list)
    for v in h['axe']['violations']:
        for n in v['nodes']: vnodes[v['id']].append(n['html'])
    def axe_hit(token, rules):
        if not token: return False
        return any(token in x for r in rules for x in vnodes.get(r, []))
    for it in m['images']['items']:
        alt = it.get('alt')
        b = base(it.get('src'))
        axe_fail = axe_hit(b, IMG_RULES)
        if alt is None: altc = 'missing'
        elif alt.strip() == '': altc = 'empty'
        else: altc = 'text'
        ai_eval = (it.get('source') in ('ai-evaluation','ai-decorative-check')) and it.get('pass') is not None
        rule = img_rule(alt) if altc == 'text' else None
        rows_img.append(dict(site=key, cat=CAT[key], src=it.get('src'), alt=alt, altc=altc, axe_fail=axe_fail,
            ai_eval=ai_eval, ai_fail=(it.get('pass') is False) if ai_eval else None, src_mod=it.get('source'),
            skipped=bool(it.get('skipped')), rule=rule, ai_generic=it.get('isGenericPlaceholder'),
            imageType=it.get('imageType'), decorative=it.get('isDecorative')))
    for it in m['links']['items']:
        t = it.get('text','')
        href = it.get('href') or ''
        axe_fail = axe_hit(href.split('#')[0][-40:] if href else '', {'link-name'}) if t.strip()=='' else False
        ai_eval = not it.get('skipped') and it.get('pass') is not None
        rows_lnk.append(dict(site=key, cat=CAT[key], text=' '.join(t.split()), href=href, axe_fail=axe_fail,
            ai_eval=ai_eval, ai_fail=(it.get('pass') is False) if ai_eval else None, rule=link_rule(t)))
    site_rows.append(dict(site=key, cat=CAT[key], hybrid=h['finalScore'], axe=h['axeOnlyScore'],
        axe_viol=len(h['axe']['violations']), axe_pass=h['axe']['passCount'], title_ai=m['pageTitle']['score'],
        title_fail=m['pageTitle']['failed'], head_score=m['headings']['score']))

def w(name, rows):
    with open(os.path.join(OUT,name),'w',newline='',encoding='utf8') as fh:
        wr=csv.DictWriter(fh, fieldnames=list(rows[0].keys())); wr.writeheader(); wr.writerows(rows)
w('images.csv', rows_img); w('links.csv', rows_lnk); w('sites.csv', site_rows)

R = {}
def ci(k,n):
    if n==0: return (None,None)
    c = binomtest(k,n).proportion_ci(method='exact'); return (round(100*c.low,1), round(100*c.high,1))
def pct(k,n): return round(100*k/n,1) if n else None

# ---------- images ----------
I = rows_img
R['img_total']=len(I)
R['img_altclass']=collections.Counter(r['altc'] for r in I)
R['img_axe_fail']=sum(r['axe_fail'] for r in I)
R['img_missing_axe_flagged']=sum(1 for r in I if r['altc']=='missing' and r['axe_fail'])
passed = [r for r in I if not r['axe_fail'] and r['altc'] in ('text','empty')]
R['img_axe_passed_with_alt']=len(passed)
obj = [r for r in passed if r['rule']]
R['img_F30']=len(obj); R['img_F30_pct']=pct(len(obj),len(passed)); R['img_F30_ci']=ci(len(obj),len(passed))
R['img_F30_by_rule']=collections.Counter(r['rule'] for r in obj)
R['img_F30_sites']=len({r['site'] for r in obj})
obj_ai=[r for r in obj if r['ai_eval']]
R['img_F30_ai_eval']=len(obj_ai); R['img_F30_ai_fail']=sum(r['ai_fail'] for r in obj_ai)
R['img_F30_ai_recall']=pct(R['img_F30_ai_fail'],len(obj_ai)); R['img_F30_ai_ci']=ci(R['img_F30_ai_fail'],len(obj_ai))
R['img_F30_ai_missed']=[(r['site'],r['alt']) for r in obj_ai if not r['ai_fail']]
R['img_F30_not_ai']=[(r['site'],r['alt'],r['src_mod']) for r in obj if not r['ai_eval']][:30]
# empty alt
emp=[r for r in passed if r['altc']=='empty']
emp_ai=[r for r in emp if r['ai_eval']]
R['img_empty_passed']=len(emp); R['img_empty_ai_eval']=len(emp_ai); R['img_empty_ai_fail']=sum(r['ai_fail'] for r in emp_ai)
R['img_empty_ai_fail_types']=collections.Counter(r['imageType'] for r in emp_ai if r['ai_fail'])
# non-empty, no rule -> AI judgement only
oth=[r for r in passed if r['altc']=='text' and not r['rule'] and r['ai_eval']]
R['img_text_norule_ai_eval']=len(oth); R['img_text_norule_ai_fail']=sum(r['ai_fail'] for r in oth)
R['img_passed_ai_eval']=sum(1 for r in passed if r['ai_eval'])
R['img_passed_ai_fail']=sum(1 for r in passed if r['ai_eval'] and r['ai_fail'])
R['img_skipped']=sum(1 for r in I if r['skipped'])

# McNemar on documented failures: images (missing alt + F30) where both verdicts exist
# rule-based detector = axe; hybrid = axe OR pipeline (rule-based missing check / AI)
G=[r for r in I if r['altc']=='missing' or (r['rule'] and not r['axe_fail'])]
G=[r for r in I if (r['altc']=='missing') or r['rule']]
hyb=lambda r: r['axe_fail'] or r['altc']=='missing' or bool(r['ai_fail'])
a=sum(1 for r in G if r['axe_fail'] and hyb(r)); b=sum(1 for r in G if r['axe_fail'] and not hyb(r))
c=sum(1 for r in G if not r['axe_fail'] and hyb(r)); d=sum(1 for r in G if not r['axe_fail'] and not hyb(r))
R['img_G']=len(G); R['img_G_table']=(a,b,c,d)
R['img_G_axe_recall']=pct(a+b,len(G)); R['img_G_hyb_recall']=pct(a+c,len(G))
R['img_G_mcnemar_p']=mcnemar([[a,b],[c,d]],exact=True).pvalue

# ---------- links ----------
L=rows_lnk
R['lnk_total']=len(L); R['lnk_empty_text']=sum(1 for r in L if r['text']=='')
lp=[r for r in L if r['text']!='']   # axe link-name passes any link with text
R['lnk_axe_passed']=len(lp)
lo=[r for r in lp if r['rule']]
R['lnk_F84']=len(lo); R['lnk_F84_pct']=pct(len(lo),len(lp)); R['lnk_F84_ci']=ci(len(lo),len(lp))
R['lnk_F84_by_rule']=collections.Counter(r['rule'] for r in lo); R['lnk_F84_sites']=len({r['site'] for r in lo})
loa=[r for r in lo if r['ai_eval']]
R['lnk_F84_ai_eval']=len(loa); R['lnk_F84_ai_fail']=sum(r['ai_fail'] for r in loa)
R['lnk_F84_ai_recall']=pct(R['lnk_F84_ai_fail'],len(loa)); R['lnk_F84_ai_ci']=ci(R['lnk_F84_ai_fail'],len(loa))
R['lnk_F84_ai_missed']=collections.Counter(r['text'] for r in loa if not r['ai_fail']).most_common(20)
R['lnk_F84_texts']=collections.Counter(r['text'].lower() for r in lo).most_common(25)
# identical text -> different destinations on same page (ACT-style check), for F84 links
dup=collections.defaultdict(set)
for r in lo: dup[(r['site'],r['text'].lower())].add(r['href'])
R['lnk_F84_multi_dest_groups']=sum(1 for v in dup.values() if len(v)>1)
R['lnk_passed_ai_eval']=sum(1 for r in lp if r['ai_eval']); R['lnk_passed_ai_fail']=sum(1 for r in lp if r['ai_eval'] and r['ai_fail'])
nr=[r for r in lp if not r['rule'] and r['ai_eval']]
R['lnk_norule_ai_eval']=len(nr); R['lnk_norule_ai_fail']=sum(r['ai_fail'] for r in nr)
R['lnk_norule_ai_fail_top']=collections.Counter(r['text'] for r in nr if r['ai_fail']).most_common(40)

# ---------- per-site false-pass rate and paired test ----------
per=[]
for s in site_rows:
    k=s['site']
    ip=[r for r in passed if r['site']==k]; lpp=[r for r in lp if r['site']==k]
    n=len(ip)+len(lpp); fp=sum(1 for r in ip if r['rule'])+sum(1 for r in lpp if r['rule'])
    per.append(dict(site=k,cat=s['cat'],n_passed=n,objective_fp=fp,fp_rate=pct(fp,n),
        img_fp=sum(1 for r in ip if r['rule']), lnk_fp=sum(1 for r in lpp if r['rule']),
        ai_fail_img=sum(1 for r in ip if r['ai_fail']), ai_fail_lnk=sum(1 for r in lpp if r['ai_fail']), axe=s['axe'], hybrid=s['hybrid'],
        title_ai=s['title_ai']))
w('per_site.csv', per)
R['sites_with_fp']=sum(1 for p in per if p['objective_fp']>0)
rates=sorted(p['fp_rate'] for p in per)
import statistics as st
R['site_fp_rate_median']=st.median(rates); R['site_fp_rate_range']=(rates[0],rates[-1]); R['site_fp_rate_mean']=round(st.mean(rates),1)
R['title_axe_fail']=0
R['title_ai_failed_sites']=sum(1 for s in site_rows if s['title_fail']>0)
R['axe_zero_sites']=sum(1 for s in site_rows if s['axe']==0)

json.dump(R, open(os.path.join(OUT,'results.json'),'w'), ensure_ascii=False, indent=1, default=str)
for k,v in R.items(): print(k,':',v)
