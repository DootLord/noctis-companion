import json,re
from pathlib import Path
P=Path('/mnt/data/noctis-v6-work/data/wizard-spells-2014.json')
spells=json.loads(P.read_text())

PHRASES={
    'ghostly. skeletal':'ghostly, skeletal',
    'turn Until':'turn. Until',
    'level(':'level (',
    'Yott':'You',
    'YOII':'you',
    'IIp':'up',
    'saIt':'salt',
    'heIm':'helm',
    'eIther':'either',
    'can\'l':"can't",
    'ean\'t':"can't",
    'not\'t':'not',
    'fram':'from',
    'bya':'by a',
    'thc':'the',
    'beco me':'become',
    'holling':'holding',
    'foree':'force',
    'doar':'door',
    'pau r':'pour',
    'sweet oit':'sweet oil',
    'brimstone and oit':'brimstone and oil',
    'eup shape':'cup shape',
    'speed ofO':'speed of 0',
    'twenty-live':'twenty-five',
    'formoAn':'form. An',
    'nonliving- ing':'nonliving',
    'or\'object':'or object',
    'rape disappear':'rope disappear',
    'crass through':'cross through',
    'number hulk':'umber hulk',
    'As/eep':'Asleep',
    'S/eep':'Sleep',
    'damage nr if':'damage or if',
    'seI an alarm':'set an alarm',
    'The light ean be':'The light can be',
    'you ean ':'you can ',
    'You ean ':'You can ',
    'The spell ean ':'The spell can ',
    'it ean ':'it can ',
    'It ean ':'It can ',
    'be east through':'be cast through',
    'you east it':'you cast it',
    'you east this':'you cast this',
    'You east this':'You cast this',
    'spell is east':'spell is cast',
    'AI any lime':'At any time',
    'AI the upper':'At the upper',
    'AI the end':'At the end',
    ']f ':'If ',
    'or\'3 feet of wood or\'dir!.':'or 3 feet of wood or dirt.',
    '3-foOl-by-5-fool':'3-foot-by-5-foot',
    '30-footlong':'30-foot-long',
    'unimpedable motion':'unstoppable motion',
    'cantrall':'contrail',
}

# Only the old PHB extraction needs the aggressive OCR substitutions below.
def clean_phb(text):
    if not text: return text
    for a,b in PHRASES.items(): text=text.replace(a,b)
    text=text.replace('SeIf','Self')
    # 'White' is a recurring OCR substitution for 'While' in the PHB text.
    text=re.sub(r'\bWhite\s+(?=(?:the|a|an|affected|charmed|cursed|frightened|insane|on|in|there|you|these|those|possessing|this|target|creature)\b)', 'While ', text)
    # Common digit/measurement confusions.
    text=re.sub(r'\blOO\b','100',text)
    text=re.sub(r'\blO\b','10',text)
    text=re.sub(r'\bI (?=(?:foot|inch|hour|round|cubic|mile|minute)\b)','1 ',text)
    text=re.sub(r'\bO hit points\b','0 hit points',text)
    text=re.sub(r'\bld(\d+)\b',r'1d\1',text)
    text=re.sub(r'(?i)(\d+)-fo[oO]l',r'\1-foot',text)
    text=re.sub(r'(?i)\b(\d+)\.fool\.radius\b',r'\1-foot-radius',text)
    text=re.sub(r'(?i)\b(\d+)-\s*fool\b',r'\1-foot',text)
    text=re.sub(r'\bcubic fool\b','cubic foot',text)
    text=re.sub(r'\bextra fool\b','extra foot',text)
    text=re.sub(r'\bou[lI]\b','out',text)
    text=re.sub(r'\bean\b','can',text)
    text=re.sub(r'\bdean\b','clean',text)
    text=re.sub(r'\blakes(?=\s+\d+d\d+)','takes',text)
    text=text.replace('The enchantment causes creatures of the kind you designated to feet an intense urge','The enchantment causes creatures of the kind you designated to feel an intense urge')
    text=text.replace('lakes fire damage','takes fire damage').replace('lakes 3d6 bludgeoning','takes 3d6 bludgeoning')
    # Clean sentence-boundary OCR where punctuation was mistaken for a period.
    text=text.replace('turn If ','turn. If ').replace('turn When ','turn. When ')
    text=re.sub(r'\s+([,.;:!?])',r'\1',text)
    text=re.sub(r'\s{2,}',' ',text).strip()
    return text

def clean_ryoko(text):
    if not text:return text
    for a,b in {
      'in- cluding':'including','ac- tion':'action','ap- pears':'appears','di- ameter':'diameter',
      '30-footlong':'30-foot-long','with range':'within range','unimpedable motion':'unstoppable motion',
      'cantrall':'contrail','Ar- cana':'Arcana','Large of smaller':'Large or smaller'
    }.items(): text=text.replace(a,b)
    text=re.sub(r'\b([A-Za-z]{2,})-\s+([a-z]{2,})\b',lambda m:m.group(1)+m.group(2),text)
    text=re.sub(r'(\d+-foot-)\s+([A-Za-z])',r'\1\2',text)
    text=re.sub(r'\s+([,.;:!?])',r'\1',text)
    text=re.sub(r'\s{2,}',' ',text).strip()
    return text

for s in spells:
    fn=clean_ryoko if s.get('sourceShort')=='RYOKO v0.90' else clean_phb
    for field in ['casting_time','range','material','duration','description','higher_level']:
        s[field]=fn(str(s.get(field,'') or ''))
    s['desc']=[s['description']] if s.get('description') else []
    bits=re.split(r'(?<=[.!?])\s+',s.get('description',''))
    summary=' '.join(bits[:2]).strip()
    if len(summary)>430: summary=summary[:427].rsplit(' ',1)[0]+'…'
    s['summary']=summary

print('Cleaned',len(spells),'spells')

# Hand-clean a few legacy PHB entries where the old PDF text layer bled columns/tables together.
OVERRIDES={
  "Delayed Blast Fireball": {
    "range":"150 feet", "duration":"Concentration, up to 1 minute", "material":"a tiny ball of bat guano and sulfur", "concentration":True,
  },
  "Demiplane": {
    "range":"60 feet", "duration":"1 hour", "concentration":False,
    "description":"You create a shadowy door on a flat solid surface within range. Opening it leads to an extradimensional room about 30 feet in each dimension. When the spell ends, the door disappears but anything left inside remains there. Each casting can create a new demiplane or reconnect to one you created previously; with sufficient knowledge, you can also connect to another creature’s demiplane.",
    "higher_level":"",
  },
  "Animate Objects": {
    "description":"Choose up to ten nonmagical objects within range that are not being worn or carried. The objects animate as creatures under your control; larger objects count as multiple choices. As a bonus action, you can issue commands to any animated objects within 500 feet. Their combat statistics depend on their size, and they continue following a command until it is completed or you give another one.",
  },
  "Otiluke's Resilient Sphere": {
    "description":"A shimmering sphere of force encloses a Large or smaller creature or object within range. An unwilling creature can make a Dexterity saving throw to avoid being enclosed. Nothing physical or magical can pass through the barrier, though a creature inside can breathe. The sphere is immune to damage, can be rolled or moved, and is destroyed by disintegrate.",
  },
  "Reverse Gravity": {
    "duration":"Concentration, up to 1 minute", "material":"a lodestone and iron filings", "concentration":True,
    "description":"Gravity reverses in a 50-foot-radius, 100-foot-high cylinder. Unanchored creatures and objects fall upward toward the top of the area; a creature may be able to grab a fixed object with a Dexterity saving throw. Anything that reaches a solid surface takes falling damage as normal. When the spell ends, affected creatures and objects fall back down.",
  },
  "Locate Object": {
    "description":"Describe or name an object familiar to you. If it is within 1,000 feet, you sense the direction to its location and, if it is moving, the direction of its movement. You can locate a specific object you have seen up close or the nearest object of a particular kind. Lead blocking a direct path prevents the spell from locating it.",
  },
  "Locate Creature": {
    "description":"Describe or name a creature familiar to you. If it is within 1,000 feet, you sense the direction to its location and, if it is moving, the direction of its movement. You can locate a specific creature or the nearest creature of a particular kind that you have seen up close. The spell cannot find a transformed creature, and running water at least 10 feet wide blocks it.",
  },
  "Prestidigitation": {
    "description":"You create a minor magical effect within range: a harmless sensory effect, lighting or snuffing a small flame, cleaning or soiling a small object, warming, chilling, or flavouring a small amount of material, placing a temporary mark or symbol, or creating a tiny nonmagical trinket or illusory image. You can have up to three non-instantaneous effects active at once and dismiss one as an action.",
  },
  "Bestow Curse": {
    "description":"Touch one creature. It must make a Wisdom saving throw or be cursed for the spell's duration. When you cast the spell, choose a curse: disadvantage on checks and saves using one ability score; disadvantage on attacks against you; a Wisdom save at the start of each turn or the target wastes its action; or your attacks and spells deal an extra 1d8 necrotic damage to it. Remove curse ends the effect, and the DM may allow another curse of similar power.",
  },
  "Magic Circle": {
    "description":"Create a 10-foot-radius, 20-foot-high cylinder of magical energy at a point on the ground within range. Choose celestials, elementals, fey, fiends, undead, or any combination of those types. Chosen creatures have difficulty entering the cylinder, have disadvantage on attacks against creatures inside it, and cannot charm, frighten, or possess targets inside. You can reverse the circle so that it traps the chosen creatures inside instead.",
  },
  "Cloudkill": {
    "description":"Create a 20-foot-radius sphere of poisonous yellow-green fog at a point within range. The area is heavily obscured. A creature that enters the fog for the first time on a turn or starts its turn there makes a Constitution saving throw, taking 5d8 poison damage on a failure or half on a success. The fog moves 10 feet away from you at the start of each of your turns and sinks into low areas; strong wind disperses it and ends the spell.",
  },
  "Circle of Death": {
    "description":"Negative energy erupts in a 60-foot-radius sphere centred on a point within range. Each creature in the area makes a Constitution saving throw, taking 8d6 necrotic damage on a failed save or half as much on a successful one.",
    "higher_level":"When cast using a spell slot of 7th level or higher, the damage increases by 2d6 for each slot level above 6th.",
  },
  "Guards and Wards": {
    "description":"Ward up to 2,500 square feet of floor space in a stronghold for 24 hours. The spell fills corridors with obscuring fog, confuses navigation, magically locks doors, fills stairs with webs, and lets you place several additional magical effects such as dancing lights, magic mouth, stinking cloud, gust of wind, or suggestion. You can name creatures that ignore some or all of the wards and set a password. Casting the spell in the same place every day for one year makes the ward permanent.",
  },
  "Astral Projection": {
    "description":"You and up to eight willing creatures project your astral bodies into the Astral Plane while your physical bodies remain unconscious in suspended animation. Each astral form is connected to its body by a silvery cord; if that cord is severed, the creature dies. Astral forms can travel through the Astral Plane and its portals. Entering another plane carries the creature's body and possessions along the cord so it can re-enter its body. The spell ends for a creature when dismissed, dispelled, or when either its physical or astral form is reduced to 0 hit points.",
  },
  "Wish": {
    "casting_time":"1 action",
    "description":"Wish lets you reshape reality. Its safest use is to duplicate any spell of 8th level or lower without meeting that spell's normal requirements. You can instead attempt one of several powerful effects, such as creating a valuable nonmagical object, restoring a group of creatures, granting resistance or temporary immunity, or forcing a recent roll to be rerolled. You may ask for something beyond those examples, but the DM decides the outcome and unintended consequences are possible. Using wish for anything other than duplicating a spell causes severe magical stress and carries a chance that you can never cast wish again.",
  },
  "Lightning Bolt": {"duration":"Instantaneous"},
  "Wall of Stone": {"duration":"Concentration, up to 10 minutes"},
  "Programmed Illusion": {"casting_time":"1 action"},
}

# Apply overrides after OCR substitutions, then regenerate display text.
for s in spells:
    if s.get('sourceShort')=='PHB 2014' and s['name'] in OVERRIDES:
        s.update(OVERRIDES[s['name']])
        s['desc']=[s['description']] if s.get('description') else []
        bits=re.split(r'(?<=[.!?])\s+',s.get('description',''))
        summary=' '.join(bits[:2]).strip()
        if len(summary)>430: summary=summary[:427].rsplit(' ',1)[0]+'…'
        s['summary']=summary

P.write_text(json.dumps(spells,indent=2,ensure_ascii=False)+'\n')
print('Applied legacy PHB overrides:', len(OVERRIDES))
