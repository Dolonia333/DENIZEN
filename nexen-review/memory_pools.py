"""Code-owned topical retrieval policy over existing provenance-preserving indexes."""
import re

POOLS={
 'commerce':{'label':'Lumipaw and business','terms':('lumipaw','amboras','dropshipping','advertising','checkout','supplier','product ads','ecommerce')},
 'music':{'label':'Music and releases','terms':('stems','stem export','fl studio','flp','discography','music','mixing','mastering','release')},
 'life':{'label':'Life and situations','terms':('rent','housing','notice','meals','mood','adhd','situation','life os')},
 'game':{'label':'WDR City and design','terms':('wdr city','lookbook','avatar','rover','game','clothes','streetwear')},
 'voice':{'label':'JARVIS and voice','terms':('jarvis','microphone','voice','speech','tts','vosk','photo analysis')},
 'automation':{'label':'Tools and automation','terms':('n8n','openclaw','omniroute','ollama','harness','workflow','automation','mcp','connector')},
 'engineering':{'label':'Code and quality','terms':('architecture','testing','tests','tdd','code review','refactor','module','coding methodology','bug')},
}
NAMED=('lumipaw','amboras','n8n','openclaw','omniroute','ollama','vosk','fl studio','wdr city')

def has(text,term):
    return re.search(r'(?<!\w)'+re.escape(term)+r'(?!\w)',text,re.I) is not None

def query_plan(query,terms,requested=None):
    text=query[:4000].lower()
    if requested is not None and requested not in POOLS and requested!='all':raise ValueError('Unknown memory pool')
    matched={key:[term for term in value['terms'] if has(text,term)] for key,value in POOLS.items()}
    selected=requested if requested not in (None,'all') else max(matched,key=lambda k:sum(4 if t in NAMED else 1 for t in matched[k]))
    if requested=='all' or (requested is None and not any(matched.values())):selected='all'
    anchors=[name for name in NAMED if has(text,name)]
    if not anchors and selected!='all':anchors=matched[selected]
    retrieval=list(dict.fromkeys(anchors+terms))[:12]
    return {'id':selected,'label':POOLS[selected]['label'] if selected!='all' else 'All knowledge',
            'anchors':anchors,'terms':retrieval,'explicit':requested is not None}

def rank_candidates(candidates,plan):
    ranked=[];seen=set()
    for candidate in candidates:
        identity=(candidate.get('kind'),candidate.get('source_id'))
        if identity in seen:continue
        seen.add(identity)
        title=str(candidate.get('title','')).lower();body=str(candidate.get('text','')).lower()
        combined=title+' '+body
        # Named task evidence is required when a named tool/product was requested.
        # Returning little data is preferable to substituting another project.
        anchors=plan['anchors']
        if anchors and not any(has(combined,a) for a in anchors):continue
        if plan['explicit'] and plan['id']!='all' and not any(has(combined,t) for t in POOLS[plan['id']]['terms']):continue
        score=sum((8 if has(title,a) else 0)+(4 if has(body,a) else 0) for a in anchors)
        score+=sum((2 if has(title,t) else 0)+(1 if has(body,t) else 0) for t in plan['terms'])
        if candidate.get('kind')=='completion':score+=1
        ranked.append((score,candidate))
    ranked.sort(key=lambda row:row[0],reverse=True)
    return [row[1] for row in ranked]

def excerpt(body,plan,size=1100):
    lower=body.lower()
    anchors=plan['anchors'] or plan['terms']
    positions=[match.start() for term in anchors for match in re.finditer(r'(?<!\w)'+re.escape(term)+r'(?!\w)',lower)]
    starts={max(0,position-120) for position in positions}|{0}
    def score(start):
        chunk=lower[start:start+size]
        return 4*sum(has(chunk,a) for a in plan['anchors'])+sum(has(chunk,t) for t in plan['terms'])
    start=max(sorted(starts),key=score)
    return body[start:start+size]
