import re, json, unicodedata
from pathlib import Path

RAW=Path('/mnt/data/phb_spells_raw.txt')
OUT=Path('/mnt/data/noctis-companion/data/wizard-spells-2014.json')

LEVELS = {
0: "Acid Splash|Blade Ward|Chill Touch|Dancing Lights|Fire Bolt|Friends|Light|Mage Hand|Mending|Message|Minor Illusion|Poison Spray|Prestidigitation|Ray of Frost|Shocking Grasp|True Strike".split('|'),
1: "Alarm|Burning Hands|Charm Person|Chromatic Orb|Color Spray|Comprehend Languages|Detect Magic|Disguise Self|Expeditious Retreat|False Life|Feather Fall|Find Familiar|Fog Cloud|Grease|Identify|Illusory Script|Jump|Longstrider|Mage Armor|Magic Missile|Protection from Evil and Good|Ray of Sickness|Shield|Silent Image|Sleep|Tasha's Hideous Laughter|Tenser's Floating Disk|Thunderwave|Unseen Servant|Witch Bolt".split('|'),
2: "Alter Self|Arcane Lock|Blindness/Deafness|Blur|Cloud of Daggers|Continual Flame|Crown of Madness|Darkness|Darkvision|Detect Thoughts|Enlarge/Reduce|Flaming Sphere|Gentle Repose|Gust of Wind|Hold Person|Invisibility|Knock|Levitate|Locate Object|Magic Mouth|Magic Weapon|Melf's Acid Arrow|Mirror Image|Misty Step|Nystul's Magic Aura|Phantasmal Force|Ray of Enfeeblement|Rope Trick|Scorching Ray|See Invisibility|Shatter|Spider Climb|Suggestion|Web".split('|'),
3: "Animate Dead|Bestow Curse|Blink|Clairvoyance|Counterspell|Dispel Magic|Fear|Feign Death|Fireball|Fly|Gaseous Form|Glyph of Warding|Haste|Hypnotic Pattern|Leomund's Tiny Hut|Lightning Bolt|Magic Circle|Major Image|Nondetection|Phantom Steed|Protection from Energy|Remove Curse|Sending|Sleet Storm|Slow|Stinking Cloud|Tongues|Vampiric Touch|Water Breathing".split('|'),
4: "Arcane Eye|Banishment|Blight|Confusion|Conjure Minor Elementals|Control Water|Dimension Door|Evard's Black Tentacles|Fabricate|Fire Shield|Greater Invisibility|Hallucinatory Terrain|Ice Storm|Leomund's Secret Chest|Locate Creature|Mordenkainen's Faithful Hound|Mordenkainen's Private Sanctum|Otiluke's Resilient Sphere|Phantasmal Killer|Polymorph|Stone Shape|Stoneskin|Wall of Fire".split('|'),
5: "Animate Objects|Bigby's Hand|Cloudkill|Cone of Cold|Conjure Elemental|Contact Other Plane|Creation|Dominate Person|Dream|Geas|Hold Monster|Legend Lore|Mislead|Modify Memory|Passwall|Planar Binding|Rary's Telepathic Bond|Scrying|Seeming|Telekinesis|Teleportation Circle|Wall of Force|Wall of Stone".split('|'),
6: "Arcane Gate|Chain Lightning|Circle of Death|Contingency|Create Undead|Disintegrate|Drawmij's Instant Summons|Eyebite|Flesh to Stone|Globe of Invulnerability|Guards and Wards|Magic Jar|Mass Suggestion|Move Earth|Otiluke's Freezing Sphere|Otto's Irresistible Dance|Programmed Illusion|Sunbeam|True Seeing|Wall of Ice".split('|'),
7: "Delayed Blast Fireball|Etherealness|Finger of Death|Forcecage|Mirage Arcane|Mordenkainen's Magnificent Mansion|Mordenkainen's Sword|Plane Shift|Prismatic Spray|Project Image|Reverse Gravity|Sequester|Simulacrum|Symbol|Teleport".split('|'),
8: "Antimagic Field|Antipathy/Sympathy|Clone|Control Weather|Demiplane|Dominate Monster|Feeblemind|Incendiary Cloud|Maze|Mind Blank|Power Word Stun|Sunburst|Telepathy|Trap the Soul".split('|'),
9: "Astral Projection|Foresight|Gate|Imprisonment|Meteor Swarm|Power Word Kill|Prismatic Wall|Shapechange|Time Stop|True Polymorph|Weird|Wish".split('|'),
}

SCHOOL_OVERRIDES = {
    "Minor Illusion":"Illusion","Color Spray":"Illusion","Disguise Self":"Illusion","Illusory Script":"Illusion","Silent Image":"Illusion",
    "Flaming Sphere":"Conjuration","Gentle Repose":"Necromancy","Magic Mouth":"Illusion","Phantasmal Force":"Illusion",
    "Bestow Curse":"Necromancy","Fear":"Illusion","Hypnotic Pattern":"Illusion","Phantom Steed":"Illusion",
    "Control Water":"Transmutation","Hallucinatory Terrain":"Illusion","Mordenkainen's Faithful Hound":"Conjuration",
    "Conjure Elemental":"Conjuration","Creation":"Illusion","Dream":"Illusion","Seeming":"Illusion","Telekinesis":"Transmutation",
    "Mordenkainen's Magnificent Mansion":"Conjuration","Mordenkainen's Sword":"Evocation","Project Image":"Illusion","Trap the Soul":"Conjuration"
}

ALIASES = {
    "Find Familiar": "FINO FAMILIAR",
    "Mage Armor": "MAGEARMOR",
    "Gust of Wind": "GUSTOFWIND",
    "Spider Climb": "SPIDER CUMB",
    "Suggestion": "SUGGESTlON",
    "Dispel Magic": "DISPEL MAGIe",
    "Leomund's Tiny Hut": "LEOMUNO'S TINY HUT",
    "Nondetection": "NONDETECTlON",
    "Magic Jar": "MAGICJAR",
    "Otiluke's Freezing Sphere": "OTlLUKE'S FREEZING SPHERE",
    "Finger of Death": "FINGE R OF DEATH",
}

WORD_FIXES = {
    'Vou':'You','vou':'you','VOu':'You','lhe':'the','lhat':'that','thal':'that','lhan':'than','lhere':'there','lhis':'this','lhese':'these','lhose':'those',
    'lhey':'they','lhem':'them','lheir':'their','lhrough':'through','wilhin':'within','wilh':'with','crealure':'creature','crealures':'creatures','ereature':'creature','ereatures':'creatures',
    'largel':'target','largels':'targets','larget':'target','largets':'targets','targel':'target','targels':'targets','casl':'cast','easl':'cast','aclion':'action','aetion':'action','act ion':'action',
    'leveI':'level','levei':'level','LeveIs':'Levels','Leveis':'Levels','lnstantaneous':'Instantaneous','lnvisibility':'Invisibility',
    'Concenlralion':'Concentration','Coneentration':'Concentration','concenlration':'concentration','duralion':'duration','Duralion':'Duration',
    'effecl':'effect','attaek':'attack','objeet':'object','objeets':'objects','inereases':'increases','reaeh':'reach','rluration':'duration','adrlitional':'additional','thiek':'thick','stieky':'sticky','ehoice':'choice','eube':'cube','diffieult':'difficult','obseure':'obscure','anehored':'anchored','sueh':'such','eonjured':'conjured','eollapses':'collapses','surfaee':'surface','Eaeh':'Each','Concenlration':'Concentration' ,'effec!.':'effect.','spel1':'spell','spells ends':'spell ends','fali':'fall','ali':'all','SeI f':'Self','Seif':'Self','5elf':'Self',
    'feet.':'feet.','fee!.':'feet.','feel':'feet','minule':'minute','minules':'minutes','lO-foot':'10-foot','IO-foot':'10-foot',
    'tire':'fire','enehantment':'enchantment','neeromaney':'necromancy','Abjuratian':'Abjuration','divinatian':'divination','transmutatian':'transmutation',
}

def clean_text(s):
    s=s.replace('\x0c',' ')
    s=re.sub(r'PART\s*3\s*[I|]?\s*SPE?L+S\s*\d*',' ',s,flags=re.I)
    for a,b in WORD_FIXES.items():
        s=re.sub(rf'\b{re.escape(a)}\b',b,s)
    s=s.replace('I action','1 action').replace('I bonus action','1 bonus action').replace('I reaction','1 reaction').replace('I minute','1 minute').replace('I hour','1 hour')
    s=re.sub(r'\s+',' ',s).strip()
    s=re.sub(r'(?<![A-Za-z])I(?=d\d+)', '1', s)
    s=s.replace('Id6','1d6').replace('Id8','1d8').replace('IdlO','1d10').replace('ld6','1d6').replace('ld8','1d8').replace('ldlO','1d10').replace('/ire','fire')
    s=s.replace(' .','.').replace(' ,',',')
    return s

def slug(name):
    x=unicodedata.normalize('NFKD',name).encode('ascii','ignore').decode().lower()
    x=re.sub(r"[^a-z0-9]+",'-',x).strip('-')
    return x

def school_from(desc):
    d=desc.lower()
    for key,val in [
      ('abjur','Abjuration'),('conjur','Conjuration'),('divin','Divination'),('enchant','Enchantment'),('enehant','Enchantment'),
      ('evocat','Evocation'),('evoe','Evocation'),('illusion','Illusion'),('iliusion','Illusion'),('necroman','Necromancy'),('neeroman','Necromancy'),('transmut','Transmutation')]:
        if key in d: return val
    return 'Unknown'

lines=RAW.read_text(encoding='utf-8',errors='ignore').splitlines()
upper=[x.strip() for x in lines]
# candidate spell starts: uppercase-ish heading with a Casting Time header shortly after
starts=[]
for i,s in enumerate(upper):
    if not s or len(s)>80: continue
    if not re.fullmatch(r"[A-Z0-9' /&.,()\-]+",s): continue
    look=' '.join(upper[i+1:i+8])
    if 'Casting Time:' in look:
        starts.append(i)
# Add aliases which may contain OCR lowercase I/l and therefore missed uppercase regex.
for alias in ALIASES.values():
    for i,s in enumerate(upper):
        if s==alias:
            starts.append(i); break
starts=sorted(set(starts))

def find_start(name):
    want=ALIASES.get(name,name.upper())
    for i,s in enumerate(upper):
        if s==want: return i
    # normalize OCR-looking l/I and whitespace for last-resort match
    nw=re.sub(r'[^A-Z]','',want.upper().replace('L','I'))
    best=None
    for i,s in enumerate(upper):
        ns=re.sub(r'[^A-Z]','',s.upper().replace('L','I'))
        if ns==nw: return i
    return None

def next_start(i):
    for j in starts:
        if j>i: return j
    return len(lines)

def parse_spell(name, level):
    if name=='Trap the Soul':
        return {
          'index':slug(name),'name':name,'level':level,'school':{'name':SCHOOL_OVERRIDES.get(name,'Conjuration')},'ritual':False,
          'casting_time':'','range':'','components':[],'material':'','duration':'','concentration':False,
          'description':'This spell is listed in the wizard spell list in this printing, but no spell description was found in the supplied Player\'s Handbook text.',
          'desc':["Listed in this printing's wizard spell list; no description was found in the supplied handbook text."],
          'summary':'Listed in this printing, but the supplied handbook contains no matching spell description.',
          'source':'Player\'s Handbook (2014) supplied by user'
        }
    i=find_start(name)
    if i is None:
        print('MISSING START',name)
        return None
    j=next_start(i)
    chunk='\n'.join(lines[i:j])
    # Heading then descriptor until Casting Time
    pre, sep, rest=chunk.partition('Casting Time:')
    prelines=[x.strip() for x in pre.splitlines() if x.strip()]
    descriptor=' '.join(prelines[1:])
    school=SCHOOL_OVERRIDES.get(name, school_from(descriptor))
    ritual='ritual' in descriptor.lower()
    # Parse standard headers from remaining chunk.
    text='Casting Time:'+rest
    pat=re.compile(r'Casting Time:\s*(.*?)\nRange:\s*(.*?)\nComponents:\s*(.*?)\nDuration:\s*(.*?)(?:\n)(.*)',re.S)
    m=pat.search(text)
    if not m:
        # join wrapped header values, then retry around literal header labels
        compact='\n'.join(x.rstrip() for x in text.splitlines())
        m=pat.search(compact)
    if m:
        casting,range_,components_raw,duration,body=m.groups()
    else:
        casting=range_=components_raw=duration=''
        body='\n'.join(prelines[2:])
    casting=clean_text(casting)
    range_=clean_text(range_)
    components_raw=clean_text(components_raw).replace(',5', ', S').replace('V,5','V, S').replace('V, 5','V, S')
    duration=clean_text(duration)
    body=clean_text(body)
    # Split higher-level paragraph where possible.
    higher=''
    hm=re.search(r'(?i)At Higher Level[sI]*\.\s*(.*)$',body)
    if hm:
        higher=hm.group(1).strip()
        body=body[:hm.start()].strip()
    comps=[]
    for c in ['V','S','M']:
        if re.search(rf'(^|[, /]){c}([, /]|$)',components_raw): comps.append(c)
    material=''
    mm=re.search(r'\((.*)\)',components_raw)
    if mm: material=mm.group(1).strip()
    # Useful short card text: first ~2 sentences, capped.
    sentences=re.split(r'(?<=[.!?])\s+',body)
    summary=' '.join(sentences[:2]).strip()
    if len(summary)>420: summary=summary[:417].rsplit(' ',1)[0]+'…'
    return {
      'index':slug(name),'name':name,'level':level,'school':{'name':school},'ritual':ritual,
      'casting_time':casting,'range':range_,'components':comps,'material':material,'duration':duration,
      'concentration':'concen' in duration.lower(),'description':body,'desc':[body] if body else [],
      'higher_level':higher,'summary':summary,'source':'Player\'s Handbook (2014) supplied by user'
    }

out=[]
for level,names in LEVELS.items():
    for name in names:
        sp=parse_spell(name,level)
        if sp: out.append(sp)

OUT.write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding='utf-8')
print('wrote',len(out),'spells to',OUT)
missing=[n for lv in LEVELS.values() for n in lv if not any(s['name']==n for s in out)]
print('missing',missing)
for n in ['Acid Splash','Fire Bolt','False Life','Misty Step','Web','Animate Dead','Finger of Death','Wish']:
    s=next((x for x in out if x['name']==n),None)
    print('\n',n,json.dumps(s,ensure_ascii=False)[:900])
