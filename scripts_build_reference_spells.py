import json, re, unicodedata
from pathlib import Path
from collections import defaultdict
import pdfplumber

ROOT=Path('/mnt/data/noctis-v10-work')
PHB=Path('/mnt/data/Player\'s Handbook (2014).pdf')
RYOKO=Path('/mnt/data/Ryoko_s_Guide_to_the_Yokai_Realms_-_200dpi_-_RGYR_-_v0.90.pdf')
WIZARD_JSON=ROOT/'data'/'wizard-spells-2014.json'
OUT=ROOT/'data'/'reference-spells-2014.json'

wizard=json.loads(WIZARD_JSON.read_text())
existing_by_key={(x.get('sourceShort',''), re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',x['name']).encode('ascii','ignore').decode().lower())):x for x in wizard}

def slug(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',s).strip('-')

def keyname(s):
    return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())

def dehyphenate(lines):
    out=[]
    for raw in lines:
        s=raw.strip()
        if not s: continue
        if out and out[-1].endswith('-') and s and s[0].islower():
            out[-1]=out[-1][:-1]+s
        else:
            out.append(s)
    return out

PHB_WORD_FIXES={
    'Vou':'You','vou':'you','Vour':'Your','vour':'your','lhe':'the','Lhe':'The','lhat':'that','Lhat':'That','thal':'that','lhan':'than','lhere':'there','lhis':'this','lhese':'these','lhose':'those','lhey':'they','lhem':'them','lheir':'their','lhrough':'through','wilh':'with','wilhin':'within','wilhout':'without',
    'crealure':'creature','crealures':'creatures','ereature':'creature','ereatures':'creatures','largel':'target','largels':'targets','targel':'target','targels':'targets','casl':'cast','easl':'cast','aclion':'action','aetion':'action','minule':'minute','minules':'minutes','duralion':'duration','effecl':'effect','effecls':'effects','attaek':'attack','attaeks':'attacks','objeet':'object','objeets':'objects','inereases':'increases','reaeh':'reach','adrlitional':'additional','ehoose':'choose','ehoice':'choice','diffieult':'difficult','surfaee':'surface','anehored':'anchored','sueh':'such','fali':'fall','ali':'all','spel1':'spell','leveI':'level','levei':'level','LeveIs':'Levels','Leveis':'Levels','Concenlralion':'Concentration','Coneentration':'Concentration','concenlration':'concentration','lnstantaneous':'Instantaneous','SeIf':'Self','SeI f':'Self','Seif':'Self','5elf':'Self','louch':'touch','lurn':'turn','lurns':'turns','lake':'take','lakes':'takes','laking':'taking','deal':'deal','deals':'deals','agaln':'again','agalnst':'against','musl':'must','sueceed':'succeed','sueceeds':'succeeds','saving lhrow':'saving throw','whenever':'whenever','slart':'start','slarts':'starts','ends.':'ends.','resislance':'resistance','immunily':'immunity','abilily':'ability','abililies':'abilities','magie':'magic','Magie':'Magic','rnagic':'magic','dam age':'damage','distanee':'distance','immedialely':'immediately','creale':'create','creales':'creates','ereate':'create','ereates':'creates','yourself.':'yourself.','lO-foot':'10-foot','IO-foot':'10-foot','lO feet':'10 feet','IO feet':'10 feet','I mile':'1 mile','I hour':'1 hour','I minute':'1 minute','I action':'1 action','I bonus action':'1 bonus action','I reaction':'1 reaction','I round':'1 round','O hit':'0 hit','Ohit':'0 hit','O feet':'0 feet'
}

def clean_phb_text(s):
    s=s.replace('\x0c',' ').replace('’',"'")
    s=re.sub(r'PART\s*3\s*[I|]?\s*SPE?L+S\s*\d*',' ',s,flags=re.I)
    for a,b in PHB_WORD_FIXES.items():
        s=re.sub(rf'(?<![A-Za-z]){re.escape(a)}(?![A-Za-z])',b,s)
    s=s.replace('Id4','1d4').replace('Id6','1d6').replace('Id8','1d8').replace('Id10','1d10').replace('IdlO','1d10').replace('Id12','1d12')
    s=s.replace('ld4','1d4').replace('ld6','1d6').replace('ld8','1d8').replace('ld10','1d10').replace('ldlO','1d10').replace('ld12','1d12')
    s=s.replace(' ,',',').replace(' .','.').replace("can 't","can't").replace("doesn 't","doesn't").replace("isn 't","isn't")
    s=re.sub(r'\s+',' ',s).strip()
    return s

def clean_ryoko_text(s):
    s=s.replace('\u00ad','').replace('￾','').strip()
    s=re.sub(r'\s+',' ',s)
    return s

PHB_NAME_OVERRIDES={
'ANTIPATHy/SYMPATHY':'Antipathy/Sympathy',"BIGBY'S HAND":"Bigby's Hand","CRUSADER'S MANTLE":"Crusader's Mantle",'DETECT EVIL ANO Gooo':'Detect Evil and Good','DISPEL MAGIe':'Dispel Magic',"DRAWMIJ'S INSTANT SUMMONS":"Drawmij's Instant Summons","EVARD'S BLACK TENTACLES":"Evard's Black Tentacles",'FINGE R OF DEATH':'Finger of Death','GREATER RESTORATlON':'Greater Restoration',"HUNTER'S MARK":"Hunter's Mark",'jUMP':'Jump',"LEOMUND'S SECRET CHEST":"Leomund's Secret Chest", "LEOMUNO'S TINY HUT":"Leomund's Tiny Hut", "MELF'S ACID ARROW":"Melf's Acid Arrow", "MORDENKAINEN'S FAITHFUL HOUND":"Mordenkainen's Faithful Hound", "MORDENKAINEN'S MAGNIFICENT MANSION":"Mordenkainen's Magnificent Mansion", "MORDENKAINEN'S PRIVATE SANCTUM":"Mordenkainen's Private Sanctum", "MORDENKAINEN'S SWORD":"Mordenkainen's Sword", 'NONDETECTlON':'Nondetection', "NYSTUL'S MAGIC AURA":"Nystul's Magic Aura", "OTlLUKE'S FREEZING SPHERE":"Otiluke's Freezing Sphere", "OTILUKE'S RESILIENT SPHERE":"Otiluke's Resilient Sphere", "OTTO'S IRRESISTIBLE DANCE":"Otto's Irresistible Dance", 'PROTECTlON FROM POISON':'Protection from Poison', "RARY'S TELEPATHIC BOND":"Rary's Telepathic Bond", 'RESlSTANCE':'Resistance', 'SUGGESTlON':'Suggestion', 'SWIFT QurVER':'Swift Quiver', "TASHA'S HIDEOUS LAUGHTER":"Tasha's Hideous Laughter", "TENSER'S FLOATING DISK":"Tenser's Floating Disk", 'AR MS OF HADAR':'Arms of Hadar', 'FINO FAMILIAR':'Find Familiar','SPIDER CUMB':'Spider Climb','MAGICJAR':'Magic Jar'
}

def title_phb_name(raw):
    if raw in PHB_NAME_OVERRIDES:return PHB_NAME_OVERRIDES[raw]
    small={'of','from','and','with','to','the','without','into'}
    words=[]
    for i,w in enumerate(raw.lower().split()):
        if '/' in w:w='/'.join(p.capitalize() for p in w.split('/'))
        elif i and w in small: pass
        else:w=w.capitalize()
        words.append(w)
    return ' '.join(words)

def upper_ratio(s):
    letters=[c for c in s if c.isalpha()]
    return sum(c.isupper() for c in letters)/len(letters) if letters else 0

def parse_phb_descriptor(desc):
    n=desc.lower().replace('levei','level').replace('/evel','level').replace('./evel','-level').replace('.level','-level').replace('~evel','-level')
    n=n.replace('calltrip','cantrip').replace('canlrip','cantrip').replace('cailtrip','cantrip')
    school=None
    variants=[('abjur','Abjuration'),('conjur','Conjuration'),('divin','Divination'),('enchant','Enchantment'),('enehant','Enchantment'),('evocat','Evocation'),('illusion','Illusion'),('iliusion','Illusion'),('necroman','Necromancy'),('nccroman','Necromancy'),('transmut','Transmutation')]
    for k,v in variants:
        if k in n:school=v;break
    # The PHB text layer frequently reads 1 as l/I and 'level' as leveI/Ievel.
    if re.search(r'(?:cantrip|calltrip|eantrip|yeantrip)',n):
        level=0
    else:
        m=re.search(r'([1-9li])(?:st|nd|rd|th)',n)
        if m:
            digit=m.group(1)
            level=1 if digit in {'l','i'} else int(digit)
        else:
            level=None
    return level,school or 'Unknown','ritual' in n

def extract_metadata(block, source='phb'):
    # block begins with name + descriptor, then headers
    lines=[x.strip() for x in block if x.strip()]
    cast=range_=duration=material=''
    components=[]
    cidx=next((i for i,x in enumerate(lines) if x.startswith('Casting Time:')),None)
    ridx=next((i for i,x in enumerate(lines) if x.startswith('Range:')),None)
    compidx=next((i for i,x in enumerate(lines) if x.startswith('Components:')),None)
    didx=next((i for i,x in enumerate(lines) if x.startswith('Duration:')),None)
    if cidx is not None: cast=lines[cidx].split(':',1)[1].strip()
    if ridx is not None: range_=lines[ridx].split(':',1)[1].strip()
    if compidx is not None:
        end=didx if didx is not None and didx>compidx else compidx+1
        comp=' '.join([lines[compidx].split(':',1)[1].strip()]+lines[compidx+1:end])
        components=[c for c in ['V','S','M'] if re.search(rf'(^|[, ]){c}($|[, (])',comp)]
        mm=re.search(r'M\s*\((.*)\)',comp)
        material=mm.group(1).strip() if mm else ''
    if didx is not None: duration=lines[didx].split(':',1)[1].strip()
    return cast,range_,components,material,duration,didx

def make_summary(text):
    bits=re.split(r'(?<=[.!?])\s+',text.strip())
    s=' '.join(bits[:2]).strip()
    if len(s)>430:s=s[:427].rsplit(' ',1)[0]+'…'
    return s

# ----- PHB descriptions: two columns, page 212-290 -----
phb_stream=[]
phb_starts=[]
with pdfplumber.open(PHB) as pdf:
    for page_num in range(212,291):
        p=pdf.pages[page_num-1]
        for col,(x0,x1) in enumerate([(0,p.width/2),(p.width/2,p.width)]):
            lines=(p.crop((x0,0,x1,p.height)).extract_text(x_tolerance=2,y_tolerance=2) or '').splitlines()
            base=len(phb_stream)
            for line in lines:phb_stream.append((page_num,col,line.rstrip()))
            for i,line in enumerate(lines):
                if 'Casting Time:' not in line or i<2:continue
                desc=lines[i-1].strip()
                hs=[];j=i-2
                while j>=0 and len(hs)<3:
                    s=lines[j].strip()
                    if not s:break
                    if upper_ratio(s)>=0.60 and len(s)<100 and not re.search(r'PART\s*3|CHAPTER|SPELL DESCRIPTIONS|LEVEL$',s,re.I):
                        hs.append(s);j-=1
                    else:break
                if not hs:continue
                raw=' '.join(reversed(hs))
                phb_starts.append({'pos':base+j+1,'name':title_phb_name(raw),'raw':raw,'desc':desc,'page':page_num,'col':col})
phb_starts.sort(key=lambda x:x['pos'])

phb_entries=[]
for idx,st in enumerate(phb_starts):
    end=phb_starts[idx+1]['pos'] if idx+1<len(phb_starts) else len(phb_stream)
    block=[x[2] for x in phb_stream[st['pos']:end]]
    # remove common page furniture but preserve rules text
    block=[x for x in block if not re.fullmatch(r'\d{2,3}',x.strip()) and not re.search(r'^PART\s*3\s*[|I]?\s*SPELLS',x.strip(),re.I)]
    cast,range_,components,material,duration,didx=extract_metadata(block)
    level,school,ritual=parse_phb_descriptor(st['desc'])
    if st['name'] in {'Bless','Command'}: level=1
    if level is None: continue
    desc_lines=[] if didx is None else block[didx+1:]
    desc_lines=dehyphenate(desc_lines)
    description=clean_phb_text(' '.join(desc_lines))
    cast=clean_phb_text(cast); range_=clean_phb_text(range_); duration=clean_phb_text(duration); material=clean_phb_text(material)
    entry={
        'index':slug(st['name']),'name':st['name'],'level':level,'school':{'name':school},'ritual':ritual,
        'casting_time':cast,'range':range_,'components':components,'material':material,'duration':duration,
        'concentration':'concentration' in duration.lower(),'description':description,'desc':[description] if description else [],
        'higher_level':'','summary':make_summary(description),'classes':[],
        'source':"Player's Handbook (2014) supplied by user",'sourceShort':'PHB 2014','source_book':"Player's Handbook",'source_version':'2014'
    }
    # Prefer existing, already manually-cleaned wizard record when available.
    old=existing_by_key.get(('PHB 2014',keyname(st['name'])))
    if old:
        keep=dict(old); keep['classes']=[]; entry=keep
    phb_entries.append(entry)

# Add any Wizard entries missed by the PDF text layer (Find Familiar, Spider Climb, Demiplane, and first-printing Trap the Soul listing).
seen={keyname(x['name']) for x in phb_entries}
for old in wizard:
    if old.get('sourceShort')!='PHB 2014':continue
    if keyname(old['name']) not in seen:
        x=dict(old);x['classes']=[];phb_entries.append(x);seen.add(keyname(old['name']))


# Two descriptions are split unusually across the scanned text columns and do not expose a normal
# "Casting Time:" marker in the half-column extraction. Rebuild them from the supplied PHB text.
manual_phb = [
    {
      'index':'find-steed','name':'Find Steed','level':2,'school':{'name':'Conjuration'},'ritual':False,
      'casting_time':'10 minutes','range':'30 feet','components':['V','S'],'material':'','duration':'Instantaneous','concentration':False,
      'description':"You summon a loyal spirit that takes the form of a suitable mount such as a warhorse, pony, camel, elk, or mastiff. The spirit uses that creature's statistics but is celestial, fey, or fiendish, has at least Intelligence 6, and understands one language you speak. While mounted, a spell you cast that targets only you can also target the steed. If it drops to 0 hit points or you dismiss it, it disappears; casting the spell again returns the same bonded steed at full hit points. You can communicate with it telepathically while it is within 1 mile, and you can have only one steed bonded by this spell at a time.",
      'desc':[], 'higher_level':'', 'summary':'Summon a loyal spirit mount that shares self-targeted spells with you and can be resummoned if dismissed or reduced to 0 hit points.', 'classes':['Paladin'],
      'source':"Player's Handbook (2014) supplied by user",'sourceShort':'PHB 2014','source_book':"Player's Handbook",'source_version':'2014'
    },
    {
      'index':'destructive-wave','name':'Destructive Wave','level':5,'school':{'name':'Evocation'},'ritual':False,
      'casting_time':'1 action','range':'Self (30-foot radius)','components':['V'],'material':'','duration':'Instantaneous','concentration':False,
      'description':'You strike the ground and release a burst of divine energy. Each creature you choose within 30 feet makes a Constitution saving throw. On a failed save, it takes 5d6 thunder damage plus 5d6 radiant or necrotic damage (your choice) and falls prone. On a successful save, it takes half as much damage and is not knocked prone.',
      'desc':[], 'higher_level':'', 'summary':'Chosen creatures within 30 feet make a Constitution save or take heavy thunder plus radiant/necrotic damage and fall prone.', 'classes':['Paladin'],
      'source':"Player's Handbook (2014) supplied by user",'sourceShort':'PHB 2014','source_book':"Player's Handbook",'source_version':'2014'
    }
]
for e in manual_phb:
    e['desc']=[e['description']]
    if keyname(e['name']) not in {keyname(x['name']) for x in phb_entries}: phb_entries.append(e)

# ----- PHB class membership from the four narrow spell-list columns -----
# The class-list layout is four columns. Match its OCR text against canonical names.
canon={keyname(x['name']):x['name'] for x in phb_entries}
# common class-list OCR corrections before fuzzy matching
CLASS_FIX={'Animais':'Animals','Fali':'Fall','IlIusion':'Illusion','Shalter':'Shatter','Pattem':'Pattern','ODor':'Door','Olto':"Otto",'Cirele':'Circle','Continuai':'Continual','jSympathy':'/Sympathy','Tentades':'Tentacles','ereation':'Creation',')ump':'Jump'}
def clean_class_line(s):
    for a,b in CLASS_FIX.items():s=s.replace(a,b)
    return s.strip()

def ratio(a,b):
    import difflib
    return difflib.SequenceMatcher(None,keyname(a),keyname(b)).ratio()
class_stream=[]
with pdfplumber.open(PHB) as pdf:
    for page_num in range(208,212):
        p=pdf.pages[page_num-1]
        for col,(x0,x1) in enumerate([(35,165),(160,290),(290,415),(415,560)]):
            text=p.crop((x0,0,x1,p.height)).extract_text(x_tolerance=2,y_tolerance=2) or ''
            class_stream += [(page_num,col,x.strip()) for x in text.splitlines()]
classes=defaultdict(set)
cur_class=None;cur_level=None;i=0
class_names=['Bard','Cleric','Druid','Paladin','Ranger','Sorcerer','Warlock','Wizard']
spell_names=list(canon.values())
while i<len(class_stream):
    pn,col,raw=class_stream[i]; s=clean_class_line(raw)
    cm=re.search(r'\b(BARD|CLERIC|DRUID|PALADIN|RANGER|SORCERER|WARLOCK|WIZARD)\s+SPELLS\b',s,re.I)
    if cm:cur_class=cm.group(1).title();cur_level=None;i+=1;continue
    up=s.upper().replace('O LEVEL','0 LEVEL')
    if 'CANTRIPS' in up:cur_level=0;i+=1;continue
    lm=re.search(r'([1-9])(?:ST|ND|RD|TH)\s+LEVEL',up)
    if lm:cur_level=int(lm.group(1));i+=1;continue
    if cur_class and cur_level is not None and s and not re.search(r'PART 3|CHAPTER|DESCRIBES|DUNGEONS|alphabetical|spellcasting classes|spell descriptions|name of the spell',s,re.I):
        best=None
        for span in (3,2,1):
            if i+span>len(class_stream):continue
            parts=[];ok=True
            for k in range(span):
                pp,cc,ll=class_stream[i+k]
                if pp!=pn or cc!=col or not ll.strip():ok=False;break
                if re.search(r'\b(?:BARD|CLERIC|DRUID|PALADIN|RANGER|SORCERER|WARLOCK|WIZARD)\s+SPELLS\b',ll,re.I) or 'LEVEL' in ll.upper() or 'CANTRIPS' in ll.upper():ok=False;break
                parts.append(clean_class_line(ll))
            if not ok:continue
            combo=' '.join(parts)
            kk=keyname(combo)
            if kk in canon:score=1;nm=canon[kk]
            else:
                candidates=[n for n in spell_names if keyname(n)[:1]==kk[:1]] or spell_names
                score,nm=max((ratio(combo,n),n) for n in candidates)
            if best is None or score>best[0]:best=(score,span,nm)
        if best and best[0]>=0.86:
            score,span,nm=best
            # Avoid matching a spell to the wrong level when OCR is ambiguous.
            e=next((x for x in phb_entries if x['name']==nm),None)
            if e and int(e.get('level',-1))==int(cur_level):
                classes[nm].add(cur_class);i+=span;continue
    i+=1
# Existing wizard list is authoritative for Wizard membership.
for old in wizard:
    if old.get('sourceShort')=='PHB 2014':classes[old['name']].add('Wizard')
# A few class-list OCR lines are especially poor; explicitly recover obvious matches from the supplied page.
manual_classes={
'Bless':['Cleric','Paladin'],'Command':['Cleric','Paladin'],'Find Steed':['Paladin'],'Destructive Wave':['Paladin'],'Jump':['Druid','Ranger','Sorcerer','Wizard'],'True Strike':['Bard','Sorcerer','Warlock','Wizard'],
}
for n,cs in manual_classes.items(): classes[n].update(cs)
school_fixes={'Divine Favor':'Evocation','Flame Blade':'Evocation','Moonbeam':'Evocation','Silence':'Illusion','Spiritual Weapon':'Evocation','Conjure Animals':'Conjuration','Staggering Smite':'Evocation','Conjure Volley':'Conjuration','Transport via Plants':'Conjuration','Transport Via Plants':'Conjuration','Fire Storm':'Evocation','Destructive Wave':'Evocation'}
for e in phb_entries:
    e['classes']=sorted(classes.get(e['name'], e.get('classes',[])))
    if e['name'] in school_fixes: e['school']={'name':school_fixes[e['name']]}

# ----- Ryoko descriptions: two columns, PDF pages 283-306 -----
ry_stream=[];ry_starts=[]
with pdfplumber.open(RYOKO) as pdf:
    for page_num in range(283,307):
        p=pdf.pages[page_num-1]
        for col,(x0,x1) in enumerate([(0,p.width/2),(p.width/2,p.width)]):
            lines=(p.crop((x0,0,x1,p.height)).extract_text(x_tolerance=2,y_tolerance=2) or '').splitlines()
            base=len(ry_stream)
            for line in lines:ry_stream.append((page_num,col,line.rstrip()))
            for i,line in enumerate(lines):
                if 'Casting Time:' not in line or i<2:continue
                desc=lines[i-1].strip()
                # Ryoko title is immediately before descriptor.
                name=lines[i-2].strip()
                if not re.search(r'(cantrip|[1-9](?:st|nd|rd|th)-level)',desc,re.I):continue
                if not name or name in {'Artist Name'}:continue
                ry_starts.append({'pos':base+i-2,'name':name,'desc':desc,'page':page_num,'col':col})
ry_starts.sort(key=lambda x:x['pos'])
ry_entries=[]
for idx,st in enumerate(ry_starts):
    end=ry_starts[idx+1]['pos'] if idx+1<len(ry_starts) else len(ry_stream)
    block=[x[2] for x in ry_stream[st['pos']:end]]
    # strip recurring furniture/reversed beta watermark fragments
    block=[x for x in block if x.strip() not in {'Artist Name','emaN','tsitrA','vv00','9900','00..9900','v0.90','Chapter 13 | Spells'} and not re.fullmatch(r'\d{2,3}',x.strip())]
    lines=dehyphenate(block)
    descriptor=st['desc'].lower()
    if 'cantrip' in descriptor: level=0
    else:
        m=re.search(r'([1-9])(?:st|nd|rd|th)-level',descriptor); level=int(m.group(1)) if m else None
    if level is None:continue
    school_text=re.sub(r'^.*?(?:cantrip|[1-9](?:st|nd|rd|th)-level)\s*','',descriptor).strip()
    school_text=school_text.split('*')[0].split('(')[0].strip()
    school=school_text.title() if school_text else 'Unknown'
    ritual='ritual' in descriptor
    cast,range_,components,material,duration,didx=extract_metadata(lines,'ryoko')
    # Class can wrap over multiple lines, between Duration and first prose.
    cls=[];class_idx=next((i for i,x in enumerate(lines) if x.startswith('Class:')),None)
    desc_start=(didx+1 if didx is not None else 0)
    if class_idx is not None:
        class_parts=[lines[class_idx].split(':',1)[1].strip()]
        j=class_idx+1
        while j<len(lines) and (lines[j].startswith('Wizard') or lines[j].startswith('Tamer') or lines[j].startswith('Warlock') or lines[j].startswith('Sorcerer') or lines[j].startswith('Ranger') or lines[j].startswith('Paladin') or lines[j].startswith('Druid') or lines[j].startswith('Cleric') or lines[j].startswith('Bard') or lines[j].startswith('Bender')):
            class_parts.append(lines[j]);j+=1
        class_text=' '.join(class_parts)
        # Bender variants remain a single class label for filtering.
        for c in ['Bard','Bender','Cleric','Druid','Paladin','Ranger','Sorcerer','Tamer','Warlock','Wizard']:
            if re.search(rf'\b{c}\b',class_text):cls.append(c)
        desc_start=j
    description=clean_ryoko_text(' '.join(lines[desc_start:]))
    # remove trailing furniture that can land after the final spell in a column
    description=re.sub(r'\s+\d{2,3}\s+Chapter 13\s*\|?\s*Spells.*$','',description).strip()
    entry={
        'index':slug(st['name']),'name':st['name'],'level':level,'school':{'name':school},'ritual':ritual,
        'casting_time':cast,'range':range_,'components':components,'material':material,'duration':duration,
        'concentration':'concentration' in duration.lower(),'description':description,'desc':[description] if description else [],
        'higher_level':'','summary':make_summary(description),'classes':sorted(set(cls)),
        'source':"Ryoko's Guide to the Yokai Realms v0.90 (user-supplied)",'sourceShort':'RYOKO v0.90','source_book':"Ryoko's Guide to the Yokai Realms",'source_version':'v0.90'
    }
    old=existing_by_key.get(('RYOKO v0.90',keyname(st['name'])))
    if old:
        # Existing wizard records have already had the manual OCR pass; keep their prose but add class metadata.
        merged=dict(old);merged['classes']=entry['classes'];entry=merged
    ry_entries.append(entry)

# Verify all existing Ryoko wizard spells are retained even if a title was missed.
ry_seen={keyname(x['name']) for x in ry_entries}
for old in wizard:
    if old.get('sourceShort')!='RYOKO v0.90':continue
    if keyname(old['name']) not in ry_seen:
        x=dict(old);x['classes']=['Wizard'];ry_entries.append(x)

ryoko_school_fixes={'Earthen Fist':'Conjuration','Incendiary Strike':'Evocation','Reinforce':'Transmutation'}
for e in ry_entries:
    if e['name'] in ryoko_school_fixes: e['school']={'name':ryoko_school_fixes[e['name']]}

# Stable source/name order. Deduplicate within each source by normalized name.
out=[];seen=set()
for e in phb_entries+ry_entries:
    k=(e.get('sourceShort'),keyname(e['name']))
    if k in seen:continue
    seen.add(k);out.append(e)
out.sort(key=lambda x:(x.get('sourceShort')!='PHB 2014', int(x.get('level',0)), x['name']))
OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')

from collections import Counter
print('PHB reference spells:',sum(1 for x in out if x.get('sourceShort')=='PHB 2014'))
print('Ryoko reference spells:',sum(1 for x in out if x.get('sourceShort')=='RYOKO v0.90'))
print('Total reference spells:',len(out))
print('PHB levels:',dict(sorted(Counter(x['level'] for x in out if x.get('sourceShort')=='PHB 2014').items())))
print('Ryoko levels:',dict(sorted(Counter(x['level'] for x in out if x.get('sourceShort')=='RYOKO v0.90').items())))
print('Wizard-only catalogue unchanged:',len(wizard))
print('No-class PHB refs:',sum(1 for x in out if x.get('sourceShort')=='PHB 2014' and not x.get('classes')))
