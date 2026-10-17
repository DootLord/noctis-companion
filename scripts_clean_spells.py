import json, re
from pathlib import Path
from difflib import SequenceMatcher
import cmudict
from rapidfuzz import process, fuzz

ROOT=Path(__file__).resolve().parent
P=ROOT/'data'/'wizard-spells-2014.json'
spells=json.loads(P.read_text(encoding='utf-8'))

# Terms that are valid in D&D but are not reliably present in a general dictionary.
domain=set('''
cantrip cantrips necrotic bludgeoning slashing piercing spellcaster spellcasting
hitpoint hitpoints hp ac dc undead humanoid ooze oozes aberration aberrations celestial celestials
fey fiend fiends construct constructs elemental elementals extraplanar demiplane demiplanes
teleport teleports teleported teleportation transmute transmuted polymorph polymorphed
abjuration conjuration divination enchantment evocation illusion necromancy transmutation
arcane glyph glyphs sigil sigils radiant psychic thunder forcefire acid poison cold lightning
charisma dexterity constitution intelligence wisdom strength d20 d12 d10 d8 d6 d4
ethereal etherealness astral antimagic dispel counterspell invisibility darkvision
concentration ritual caster casters familiar familiars simulacrum simulacrums
mordenkainen leomund otiluke nystul tenser tasha bigby drawmij rary evard
chromatic phantasmal clairvoyance prestidigitation thaumaturgy
'''.split())
for s in spells:
    domain.update(re.findall(r"[a-z]+", s['name'].lower()))

# High-confidence OCR/spacing fixes seen repeatedly in the supplied PDF text layer.
PHRASE_FIXES = {
    'Voucreate':'You create','Voucan':'You can','Vouchoose':'You choose','Vouhurl':'You hurl','Vouchill':'You chill',
    'Voumake':'You make','Vouwrite':'You write','Voucraft':'You craft','Voumentally':'You mentally',
    'Voumust':'You must','Vouforge':'You forge','Vouattempt':'You attempt','Vousuggest':'You suggest',
    'Vouspeak':'You speak','Vouutter':'You utter','Vougain':'You gain','Vouand':'You and',
    'Voualso':'You also','Voudecide':'You decide','Vougrow':'You grow',
    'Vour':'Your','vour':'your','Vou':'You','vou':'you',
    'Ifyou':'If you','ifyou':'if you','ofyour':'of your','Ofyour':'Of your','inthe':'in the','tothe':'to the',
    '1fthe':'If the','1f the':'If the','1thas':'It has','1tlasts':'It lasts',
    'At Hil1her Levels.':'At Higher Levels.','At Hil1her Level.':'At Higher Level.',
    'At Hilher Levels.':'At Higher Levels.','At Hilher Level.':'At Higher Level.',
    'sma 11feat her':'small feather','sma 11feat her':'small feather',
    'lO200':'to 200','10erupt':'to erupt','1I00rplan':'floor plan','sI01leveI':'slot level',
    'si01 level':'slot level','si01you':'slot you','5thJevelevocation':'5th-level evocation',
    '17lh':'17th','41h':'4th','71h':'7th','81h':'8th','1sI':'1st',
    '2dI2':'2d12','3dI2':'3d12','4dI2':'4d12','Idl2':'1d12','ldl2':'1d12',
    '2dlO':'2d10','4dlO':'4d10','5dlO':'5d10','6dlO':'6d10','dl0':'d10','IOd8':'10d8','IOd6':'10d6','lOd8':'10d8','lOd6':'10d6',
    '1d8lightning':'1d8 lightning','IOd6lightning':'10d6 lightning','IOd6cold':'10d6 cold',
    '50ft':'50 ft','S00':'500',
    'turo':'turn','turno':'turn','turo.':'turn.','turno.':'turn.',
    'spe11ends':'spell ends','spel1ends':'spell ends','spe11becomes':'spell becomes','spe11gives':'spell gives',
    'spel1can\'t':'spell can\'t','spe11':'spell','spel1':'spell','spel!':'spell',
    'targe!':'target','effec!s':'effects','effec!':'effect','componen!':'component','poin!':'point','sunligh!':'sunlight',
    'sigi!':'sigil','Unti!':'Until','unti!':'until','fee!':'feet','!ire':'fire','!asls':'lasts','i!':'it',
    'c1ay':'clay','c1oak':'cloak','c1imbing':'climbing','c1ump':'clump','c1ass':'class','c1ipping':'clipping',
    'c1aud':'cloud','c10ud':'cloud','c10sed':'closed','c!osed':'closed','c!ose':'close','c!ean':'clean','c1eaning':'cleaning','c1othes':'clothes','C10thes':'Clothes',
    'f1eece':'fleece','f1atten':'flatten','f1yingspeed':'flying speed','e1evation':'elevation','e1se':'else',
    '5mall':'Small','5trength':'Strength','5tarting':'Starting','5ubtract':'Subtract','5hould':'should','5pecial':'Special','5ight':'Sight','5imilarly':'Similarly','5lick':'Slick',
    'entire1y':'entirely','inc1uding':'including','inc!inations':'inclinations','cha11enge':'challenge','a11':'all',
    'wa11is':'wall is','wa11and':'wall and','wa11':'wall','wal!':'wall','pane!':'panel','via!':'vial',
    'lex!':'text','ral1s':'rolls','c!arity':'clarity','leve!':'level','Leve1s':'Levels',
    '1nstantaneous':'Instantaneous','!nstantaneous':'Instantaneous',
    # recurring extraction substitutions where lowercase l was read instead of t
    'creale':'create','creales':'creates','crealed':'created','crealing':'creating','crealure':'creature','crealures':'creatures',
    'casl':'cast','casling':'casting','larget':'target','largel':'target','largels':'targets','targel':'target','targels':'targets',
    'lurn':'turn','lurns':'turns','slol':'slot','slols':'slots','wriling':'writing','wrole':'wrote','whalever':'whatever',
    'olher':'other','olhers':'others','scripl':'script','differenl':'different','differenlly':'differently','Alternalively':'Alternatively',
    'inlelligible':'intelligible','unintelligible':'unintelligible','uninteIligible':'unintelligible','lhe':'the','lhat':'that','lhis':'this','lhere':'there','lhey':'they','lhem':'them','lheir':'their','lhen':'then','lhrough':'through','wilh':'with','wilhin':'within',
    'il':'it','Il':'It','lf':'If','bul':'but','musl':'must','exislence':'existence','familiarily':'familiarity','associaled':'associated','objecl':'object','objecls':'objects','targel':'target','Descriplion':'Description','destinalion':'destination','Targel':'Target',
    'opera te':'operate','tele- portation':'teleportation','interplanar traveI':'interplanar travel',
    'hcavily':'heavily','duratioll':'duration','Canstitutian':'Constitution','Canstitution':'Constitution','paison':'poison','paisano':'poison','actian':'action','dan\'t':'don\'t','af':'of',
    'rnagnificent':'magnificent','ehambers':'chambers','furoished':'furnished','lt':'It','lIat':'flat','liame':'flame','lIammable':'flammable','aren\'l':'aren\'t',
    'oext':'next','eods':'ends','theo':'then','saviog':'saving','throwo':'throw','blioded':'blinded','bliodoess':'blindness','traosported':'transported','aoother':'another','plaoe':'plane','choosiog':'choosing','aod':'and','oear':'near','cao\'t':'can\'t',
    'statislics':'statistics','[f':'If','spe1l':'spell',
}

# A few complete phrases where OCR produced confusing but recoverable English.
SENTENCE_FIXES = {
    'A target must succeed on a Dexterity saving throw or lake 1d6 acid damage.':'A target must succeed on a Dexterity saving throw or take 1d6 acid damage.',
    'You extend your hand and trace a sigil ofwarding in the air.':'You extend your hand and trace a sigil of warding in the air.',
    'Until the end ofyour next turn.':'Until the end of your next turn,',
}

# Common D&D words that often survive as a one-character OCR error.
word_fixes = {
 'lake':'take','warding':'warding','severa':'several','severa!':'several','giyph':'glyph','expiosive':'explosive',
 'slore':'store','upto':'up to','inslead':'instead','connecl':'connect','objecl':'object','objecls':'objects',
 'lIat':'flat','sol id':'solid','rneans':'means','rneaning':'meaning','ranged':'ranged','sav ing':'saving',
 'unlil':'until','ils':'its','creaturc':'creature','creaturcs':'creatures','maintain':'maintain','cornmand':'command',
 'cornmands':'commands','sarne':'same','rnake':'make','rnakes':'makes','rnust':'must','rnight':'might',
 'rnove':'move','rnoves':'moves','rnovement':'movement','rnost':'most','rnore':'more','rnany':'many',
 'sorne':'some','tirne':'time','tirnes':'times','frorn':'from','darnage':'damage','darnaged':'damaged',
 'darnaging':'damaging','darnages':'damages','irnmediately':'immediately','irnmunity':'immunity',
 'irnmune':'immune','irnmovable':'immovable','surnmon':'summon','surnmoned':'summoned','surnmons':'summons',
 'rnaterial':'material','cornponent':'component','cornponents':'components','rnagical':'magical','rnagic':'magic',
 'rnissile':'missile','rnissiles':'missiles','rnemory':'memory','rnind':'mind','rninds':'minds','rnessage':'message',
 'rnass':'mass','rnansion':'mansion','rnouth':'mouth','rnirror':'mirror','rnajor':'major','rnale':'male',
}

# General English dictionary, used only for high-confidence one-character OCR repairs.
dict_words=set(cmudict.dict().keys())
by_len={}
for w in dict_words:
    if w.isalpha() and 2 <= len(w) <= 22:
        by_len.setdefault(len(w), []).append(w)

word_re=re.compile(r"\b[A-Za-z][A-Za-z'!0-9-]*\b")

def preserve_case(src,dst):
    if src.isupper(): return dst.upper()
    if src[:1].isupper(): return dst[:1].upper()+dst[1:]
    return dst

def dictionary_fix_token(tok):
    low=tok.lower()
    if low in domain or low in dict_words or len(low)<4 or "'" in low or '-' in low:
        return tok
    if low in word_fixes:
        return preserve_case(tok,word_fixes[low])
    # Only use dictionary guessing for words carrying classic OCR damage, or a one-edit typo.
    normalized=(low.replace('!','l').replace('0','o').replace('1','l').replace('5','s'))
    candidates=[]
    for L in range(max(2,len(normalized)-1), min(22,len(normalized)+1)+1):
        candidates.extend(by_len.get(L,()))
    if not candidates: return tok
    cand,score,_=process.extractOne(normalized,candidates,scorer=fuzz.ratio)
    # Conservative threshold: fixes obvious one-character OCR only.
    if score >= 93:
        # Avoid changing a plausible domain-ish -ic/-al word to something unrelated.
        if abs(len(cand)-len(normalized)) <= 1:
            return preserve_case(tok,cand)
    return tok

def clean(s):
    if not s: return s
    s=s.replace('\u00ad','').replace('\ufb01','fi').replace('\ufb02','fl')
    for a,b in sorted(PHRASE_FIXES.items(), key=lambda x: -len(x[0])):
        s=s.replace(a,b)
    for a,b in SENTENCE_FIXES.items(): s=s.replace(a,b)
    # Dice and level notation.
    s=re.sub(r'\b([1-9])d[lI]([02468])\b',r'\1d1\2',s)
    s=re.sub(r'\b[IiO]Od([468])\b',r'10d\1',s)
    s=re.sub(r'\b([1-9])([1I])th\b',lambda m: m.group(1)+'1th',s)
    # Split a handful of common OCR joins.
    s=re.sub(r'\b(If|When|While|Until|After|Before|As)(you|the|a)\b',r'\1 \2',s,flags=re.I)
    s=re.sub(r'\b(of|to|in|on|at|from|with)(your|the|a)\b',r'\1 \2',s,flags=re.I)
    # Standalone OCR words.
    s=re.sub(r'(?<!\w)ar(?!\w)','or',s)
    s=re.sub(r'(?<!\w)OI(?!\w)','or',s)
    s=re.sub(r'(?<!\w)af(?!\w)','of',s)
    s=re.sub(r'(?<!\w)il(?!\w)','it',s)
    # High-confidence dictionary fixes.
    s=word_re.sub(lambda m: dictionary_fix_token(m.group(0)),s)
    # Restore domain terms that a generic dictionary should never touch.
    replacements={
      'neurotic':'necrotic','bludgeonings':'bludgeoning','humanoids':'humanoids',
      'spell caster':'spellcaster','spell casting':'spellcasting'
    }
    for a,b in replacements.items(): s=re.sub(rf'\b{re.escape(a)}\b',b,s,flags=re.I)
    # Clean punctuation/spacing artifacts.
    s=re.sub(r'\s+([,.;:!?])',r'\1',s)
    s=re.sub(r'([.!?])(?=[A-Z])',r'\1 ',s)
    s=re.sub(r'\s{2,}',' ',s).strip()
    s=s.replace('..','.').replace(',,',',')
    return s

# Known cases where the source text layer bled into neighbouring tables/spells.
# Rather than preserve broken OCR, use a concise, mechanically correct English summary.
overrides={
 'Delayed Blast Fireball': {
   'description': 'A glowing bead of fire appears at a point you choose within range and grows more dangerous while you maintain concentration. When the spell ends, the bead explodes in a 20-foot-radius sphere. Creatures in the area make a Dexterity saving throw, taking heavy fire damage on a failure and half as much on a success. A creature can try to pick up and throw the bead before it detonates, but doing so risks triggering the explosion immediately.',
   'higher_level': 'Using a higher-level spell slot increases the spell’s base fire damage.',
 },
 'Create Undead': {
   'description': 'Choose corpses within range. The spell animates them as undead creatures under your control. You can give them commands, and they remain obedient for 24 hours. Casting the spell again before that period ends can reassert control. Higher-level slots let you create or maintain control over more powerful undead.',
 },
 'Teleport': {
   'description': 'You instantly transport yourself and willing creatures, or a single object, to a destination you choose on the same plane of existence. Accuracy depends on how familiar you are with the destination. A poor result can place the group off target, in a similar location, or cause a mishap that deals force damage before the spell tries again.',
 },
 'Prismatic Wall': {
   'description': 'You create a brilliant multicolored wall made of seven magical layers. Each layer has a different defensive effect and must be dealt with separately. Creatures that approach or pass through the wall can suffer severe elemental damage and other effects such as restraint, blindness, petrification, or being sent to another plane. You and creatures you designate can remain near the wall safely.',
 },
 'Antimagic Field': {
   'description': 'A 10-foot-radius invisible sphere surrounds you and suppresses magic inside it. Spells, magical effects, summoned creatures, and many magic-item properties are suppressed while they are within the field. The field moves with you and does not itself dispel magic; suppressed effects return when they leave the area or when the spell ends.',
 },
 'Glyph of Warding': {
   'description': 'You inscribe a magical glyph on a surface or object. You choose a trigger when you cast the spell. When triggered, the glyph either explodes with a chosen type of magical damage or releases a spell you stored in it. The glyph is difficult to move far from where it was created without breaking the ward.',
   'higher_level': 'A higher-level slot increases the damage of an explosive glyph and allows a spell glyph to store a higher-level spell.',
 },
 'Mordenkainen\'s Magnificent Mansion': {
   'description': 'You create an extradimensional dwelling reached through a shimmering doorway. You decide the mansion’s layout and furnishings within the spell’s limits. It contains comfortable rooms, plentiful food, and a staff of near-transparent servants that obey your instructions. Only creatures you designate can enter through the doorway.',
 },
 'True Polymorph': {
   'description': 'You transform a creature or object into another creature or object for the duration. The new form is limited by the target’s nature and challenge rating, and the target uses the statistics of its new form while transformed. If you maintain concentration for the full duration, the transformation can become permanent until dispelled or otherwise ended.',
 },
 'Telekinesis': {
   'description': 'You manipulate a creature or object with your mind. Against a creature, you contest your spellcasting ability against its Strength and can move or restrain it on a success. Against an unattended object, you can move it through the air within the spell’s limits. You can switch targets on later turns while maintaining concentration.',
 },
}

for sp in spells:
    for field in ['casting_time','range','material','duration','description','higher_level','summary']:
        sp[field]=clean(str(sp.get(field,'') or ''))
    if sp['name'] in overrides:
        sp.update(overrides[sp['name']])
    # Keep desc consistent with the cleaned description.
    sp['desc']=[sp['description']] if sp['description'] else []
    # Rebuild summary from cleaned text so cards never show stale OCR.
    if sp['description']:
        sentences=re.split(r'(?<=[.!?])\s+',sp['description'])
        summary=' '.join(sentences[:2]).strip()
        if len(summary)>430:
            summary=summary[:427].rsplit(' ',1)[0]+'…'
        sp['summary']=summary

P.write_text(json.dumps(spells,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(f'Cleaned {len(spells)} spells -> {P}')
