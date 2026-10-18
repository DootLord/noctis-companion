import json,re
from pathlib import Path
from collections import deque
from textblob.en import spelling
import cmudict

ROOT=Path(__file__).resolve().parent
P=ROOT/'data'/'reference-spells-2014.json'
spells=json.loads(P.read_text(encoding='utf-8'))

# Valid game terminology / uncommon English we don't want a generic spellchecker to "fix".
domain=set('''
cantrip cantrips necrotic bludgeoning slashing piercing spellcaster spellcasting humanoid humanoids
undead ooze oozes radiant psychic thunder abjuration conjuration divination enchantment evocation
illusion illusions illusory necromancy transmutation arcane glyph glyphs sigil sigils truesight blindsight
extradimensional nonmagical necromantic telepathically attunement phosphorescent spellcasters reroll
extraplanar demiplane demiplanes teleport teleportation polymorph concentration ritual dexterity
constitution charisma simulacrum simulacrums portals portal sulfur firefly wineskin quipper
'''.split())
for s in spells:
    domain.update(re.findall(r'[a-z]+',s['name'].lower()))

general=set(cmudict.dict()) | set(spelling)

# OCR confusion pairs in this particular PHB PDF. Generate only these variants rather than allowing
# an unrestricted spellchecker to turn D&D words into unrelated English words.
conf={
    'l':'ti','t':'l','i':'l','e':'c','c':'e','o':'na','n':'o','a':'o','f':'t',
}

manual={
    'thal':'that','ali':'all','largello':'target to','relurns':'returns','relurn':'return','hil':'hit','poinl':'point','paris':'parts','granls':'grants','len':'ten','waler':'water','mollen':'molten','slill':'still','rale':'rate','direcl':'direct','loward':'toward','unlil':'until','dexlerily':'dexterity','magie':'magic','louch':'touch','slrike':'strike','oulward':'outward','conslitution':'constitution','radiant':'radiant','necrolic':'necrotic',
    'hitariously':'hilariously','underwaler':'underwater','invisibitity':'invisibility','specia':'special',
    'blrd':'bird','jeast':'least','haur':'hour','deof':'deaf','formo':'form','currem':'current',
    'felching':'fetching','sofest':'safest','direet':'direct','spitls':'spills','spei':'spell','fiood':'flood',
    'lrench':'trench','graund':'ground','auother':'another','pitlar':'pillar','soits':'soils','raoge':'range',
    'souods':'sounds','ooce':'once','ooly':'only','soffron':'saffron','liashes':'flashes','iooks':'looks',
    'learo':'learn','fooi':'foot','foiol':'foot','floar':'floor','eheek':'check','blrd':'bird','uyes':'yes',
    'hoft':'haft','evitdoer':'evildoer','evit':'evil','chitd':'child','outtit':'outfit','umber':'number',
    'maderate':'moderate','mites':'miles','waler':'water','separaled':'separated','fiow':'flow','fiowing':'flowing',
    'whiripooi':'whirlpool','whiripool':'whirlpool','frcestanding':'freestanding','effccts':'effects','spcll':'spell',
    'rcpeat':'repeat','choosc':'choose','vehiclcs':'vehicles','fitls':'fills','disadvanlage':'disadvantage',
    'reslrained':'restrained','materiais':'materials','fabricale':'fabricate','ordinarity':'ordinarily',
    'croftsmanship':'craftsmanship','resistanee':'resistance','attaeker':'attacker','debititating':'debilitating',
    'exhauslion':'exhaustion','effecls':'effects','reduclion':'reduction','tactite':'tactile','lnvestigation':'Investigation',
    'haitstones':'hailstones','chesl':'chest','losl':'lost','mavement':'movement','sorl':'sort','divinalion':'divination',
    'casling':'casting','resuit':'result','caterpitlar':'caterpillar','detait':'detail','boited':'bolted','kitled':'killed',
    'faiture':'failure','beguite':'beguile','ineapacitated':'incapacitated','experieneed':'experienced','perfeet':'perfect',
    'detaits':'details','deseribe':'describe','eurse':'curse','ceiting':'ceiling','instabitity':'instability','eircle':'circle',
    'capabitities':'capabilities','taits':'traits','voluntarity':'voluntarily','sigits':'sights','iink':'link','tempies':'temples',
    'lhick':'thick','conliguous':'contiguous','culs':'cuts','reaclion':'reaction','verlical':'vertical','resl':'rest',
    'foundalion':'foundation','supporled':'supported','exisling':'existing','grealer':'greater','permanenl':'permanent',
    'knotled':'knotted','circie':'circle','leveis':'levels','meanwhite':'meanwhile','movemenl':'movement','shatlers':'shatters',
    'performaoce':'performance','mioutes':'minutes','ioto':'into','existeoce':'existence','fioishes':'finishes',
    'performiog':'performing','remaios':'remains','triggeriog':'triggering','geoeral':'general','withio':'within',
    'actioo':'action','examioe':'examine','determioe':'determine','agaiost':'against','destrays':'destroys',
    'muiticolored':'multicolored','petritied':'petrified','encounlered':'encountered','withoul':'without','slriking':'striking',
    'slighlly':'slightly','lodeslone':'lodestone','minerais':'minerals','designale':'designate','alarmo':'alarm',
    'duratioo':'duration','laoguage':'language','charcaal':'charcoal','unfamitiar':'unfamiliar','senso':'sensor',
    'aititude':'altitude','pieee':'piece','farked':'forked','alignmenl':'alignment','sitk':'silk','itlogical':'illogical',
    'enlrance':'entrance','dimbing':'climbing','oulside':'outside','lwisted':'twisted','hurj':'hurl','nait':'nail',
    'ceitings':'ceilings','tinishes':'finishes','aremove':'A remove','aiternative':'alternative','aitempt':'attempt',
    'ehoose':'choose','eorners':'corners','suifur':'sulfur','fali':'fall','lelhargy':'lethargy','viai':'vial',
    'existenee':'existence','effeets':'effects','eomfortable':'comfortable','eommand':'command','beeome':'become',
    'erystal':'crystal','witlingly':'willingly','penaity':'penalty','abitities':'abilities','granls':'grants',
    'affecled':'affected','respiralion':'respiration','shorl':'short','slraw':'straw','distastefui':'distasteful',
    'assauits':'assaults','cnds':'ends','fiood':'flood','concentralion':'concentration','portais':'portals',
    'erushed':'crushed','enguifed':'engulfed','statuetle':'statuette','individuais':'individuals',
    'capering':'capering','britliant':'brilliant','oifactory':'olfactory','specia':'special','onlo':'onto',

    'lomentally':'to mentally','spel':'spell','provi':'provides','contingencyends':'contingency ends','agaiu':'again',
    'aeshbegins':'flesh begins','spelj':'spell','ofwall':'of wall','othei':'other','dllst':'dust','iryou':'if you',
    'fixedobject':'fixed object','itcan':'it can','itjusl':'it just','alchemicallaboratory':'alchemical laboratory',
    'eifeet':'effect','irst':'first','minotallr':'minotaur','hollrs':'hours','buria':'burial','componenllhal':'component that',
    'ajade':'a jade','unoc':'unoc','cupied':'cupied','panions':'companions',
    'tal1cylinder':'tall cylinder','fol1owingways':'following ways','dir!':'dim','severa!':'several',
    'spelllasts':'spell lasts','unlitthe':'until the','ofyou':'of you','celestiais':'celestials','lioats':'floats',
    'tirst':'first','aturn':'a turn','ofwarding':'of warding','throllgh':'through','hollr':'hour','castthe':'cast the',
    'slalislics':'statistics','fitithe':'fill the','ofjagged':'of jagged','byan':'by an','bllrsts':'bursts',
    'spellllsing':'spell using','feellong':'feet long','rlrop':'drop','anrl':'and','lioor':'floor','iinoccupied':'unoccupied',
    'tentades':'tentacles','smelllike':'smell like','disrniss':'dismiss','youcreate':'you create','spellleaves':'spell leaves',
    'soulleaves':'soul leaves','castthis':'cast this','duplica':'duplicate','creatllre':'creature','tollch':'touch',
    'portallinking':'portal linking','yollcan':'you can','firelly':'firefly','camptire':'campfire','nonliv':'nonliving',
    'byyou':'by you','slotlevel':'slot level','throughouithe':'throughout the','scriptlhal':'script that','alleast':'at least',
    'aquaticadaptation':'aquatic adaptation','lochange':'to change','extingllish':'extinguish','lhallasls':'that lasts',
    'butlhose':'but those','successfullntelligence':'successful Intelligence','coutained':'contained','yollwith':'you with',
    'formoas':'form as','collcentration':'concentration','fivetimes':'five times','lnterposing':'Interposing',
    'hostit':'hostile','yollcast':'you cast','fitledwith':'filled with','owingways':'following ways',
    'tentades':'tentacles','formothe':'form of the','mechallical':'mechanical','pells':'spells','quitl':'quill',
    'beeomes':'becomes','desig':'design','pitlar':'pillar','soits':'soils','hasn':'has not','souods':'sounds',
    'designa':'design','eolored':'colored','sueeeed':'succeed','sueeessful':'successful','inlrusion':'intrusion',
    'bloeks':'blocks','aclive':'active','incrcases':'increases','designale':'designate','alarmo':'alarm',
    'distitled':'distilled','temporarity':'temporarily','iasting':'lasting','yaur':'your','iess':'less',
    'wheo':'when','cenlered':'centered','difficull':'difficult','lerrain':'terrain','offecting':'affecting',
    'louch':'touch','whal':'what','currenlly':'currently','parchmenl':'parchment','malerial':'material',
    'polent':'potent','lasls':'lasts','bolh':'both','pratective':'protective','armar':'armor','simuitaneously':'simultaneously',
    'thraugh':'through','missite':'missile','aiter':'alter','disceros':'discerns','roli':'roll','offect':'effect',
    'currem':'current','offects':'effects','lntelligence':'Intelligence','immobite':'immobile','iike':'like','srells':'spells',
    'mueh':'much','unseeured':'unsecured','eompletely':'completely','speit':'spell','aqualic':'aquatic','environmenl':'environment',
    'belween':'between','underwaler':'underwater','lransform':'transform','heighl':'height','weighl':'weight','lenglh':'length',
    'coloralion':'coloration','dislinguishing':'distinguishing','slays':'stays','inslance':'instance','nalural':'natural',
    'slrikes':'strikes','appropriale':'appropriate','proficienl':'proficient','difficuit':'difficult','cffect':'effect',
    'continuai':'continual','itseif':'itself','fitl':'fill','itluminate':'illuminate','coai':'coal','unoffected':'unaffected',
    'atlention':'attention','atlempt':'attempt','deteci':'detect','lhoughts':'thoughts','stitl':'still','unwitling':'unwilling',
    'muitiplied':'multiplied','avaitable':'available','thraw':'throw','aeross':'across','pineh':'pinch','iimit':'limit',
    'simitar':'similar','vertieally':'vertically','eeiting':'ceiling','whieh':'which','direetion':'direction',
    'detaited':'detailed','itlusory':'illusory','auras':'auras','simitarly':'similarly','anylhing':'anything',
    'invisibitity':'invisibility','sofest':'safest','fitled':'filled','witlingly':'willingly','thereofter':'thereafter',
    'faitures':'failures','meanwhite':'meanwhile','remaios':'remains','aoy':'any','thiogs':'things','opeo':'open',
    'ioteractioo':'interaction','successfullotelligeoce':'successful Intelligence','ovestigatioo':'Investigation',
    'pheoomeooo':'phenomenon','cooditioo':'condition','uotit':'until','thao':'than','spriogs':'springs','dormaot':'dormant',
    'maooer':'manner','agaio':'again','cao':'can','ao':'an','aoy':'any','iotangible':'intangible',
}

# Phrase-level corrections that token replacement cannot express cleanly.
phrase={
    'Ohit points':'0 hit points','0hit points':'0 hit points','White your':'While your','white your':'while your',
    'white it':'while it','white the':'while the','ofter you':'after you','ofter 4':'after 4','ofter I':'after 1',
    'ofter 1':'after 1','AIternatively':'Alternatively','Famitiar':'Familiar','famitiar':'familiar',
    'aIternative':'alternative','De.':'DC.','save De':'save DC','RolI':'Roll','roIt adIO':'roll a d10','reli a d8':'roll a d8',
    'at Jeast':'at least','per haur':'per hour','aI a':'at a','aI the':'at the','lo the':'to the',' lo ':' to ',
    'aIternatively':'alternatively','alleasl':'at least','panello create':'panel to create','walllo create':'wall to create',
    'nega tive':'negative','beca use':'because','offothers':'off others','aoy noise':'any noise','(f ovestigatioo)':'(Investigation)',
    '11 must':'It must','00 larger':'no larger','based 00':'based on','occur withio':'occur within','is 00':'is no',
    'ao object':'an object','ao itIusioo':'an illusion','itIusioo':'illusion','itlusioo':'illusion','itlusioo':'illusion',
    'itIusion':'illusion','itlusion':'illusion','itlusions':'illusions','itlusory':'illusory',
    'successfullotelligeoce':'successful Intelligence','yourself':'yourself',
    'PART 3 SPEI L~ 227 228 ':'','PART 3 SPEI L~ 227 ':'','PART 3 SPELLS 227 228 ':'',
    'fiood effect':'flood effect','Part Water.':'Part Water.','Redirect FIow.':'Redirect Flow.','WhirIpooI.':'Whirlpool.',
    '20-foot tall':'20-foot-tall','50 feet wide ai the top':'50 feet wide at the top',
}

# Build frequency map for choosing among confusion variants.
def freq(w):
    if w in domain: return 10_000_000
    return int(spelling.get(w,0))

valid=general|domain

def variants(word,max_depth=2):
    q=deque([(word,0)]); seen={word}; found=[]
    while q:
        x,d=q.popleft()
        if d>0 and x in valid:
            found.append((d,-freq(x),x))
        if d>=max_depth: continue
        for pos,ch in enumerate(x):
            for repl in conf.get(ch,''):
                y=x[:pos]+repl+x[pos+1:]
                if y not in seen:
                    seen.add(y);q.append((y,d+1))
    return sorted(found)

def fix_token(m):
    src=m.group(0); low=src.lower()
    if low in manual:
        out=manual[low]
    elif low in valid or len(low)<4 or "'" in low or '-' in low:
        return src
    else:
        found=variants(low,2)
        if not found: return src
        out=found[0][2]
    if src.isupper(): return out.upper()
    if src[:1].isupper() and not out[:1].isupper(): return out[:1].upper()+out[1:]
    return out

word_re=re.compile(r'\b[A-Za-z][A-Za-z]+\b')

def polish(text):
    if not text:return text
    # High-frequency joined-word artefacts from the PHB scan. These are
    # deliberately conservative and happen before dictionary correction.
    joined = [
        (r'\bVou(?=[a-z])', 'You '), (r'\bVour(?=[a-z])', 'Your '),
        (r'\bIfyou\b', 'If you'), (r'\bIfyou(?=[a-z])', 'If you '),
        (r'\bofyour\b', 'of your'), (r'\bofyou\b', 'of you'),
        (r'\btoyou\b', 'to you'), (r'\bbyyou\b', 'by you'),
        (r'\bwithyou\b', 'with you'), (r'\binyour\b', 'in your'),
        (r'\bAbeam\b', 'A beam'), (r'\bAflickering\b', 'A flickering'),
        (r'\bAcreature\b', 'A creature'), (r'\bAnycreature\b', 'Any creature'),
        (r'\bthetarget\b', 'the target'), (r'\bthecreature\b', 'the creature'),
        (r'\bspellends\b', 'spell ends'), (r'\bspellthen\b', 'spell then'),
        (r'\bspellthe\b', 'spell the'), (r'\bspellusing\b', 'spell using'),
        (r'\bfeetlong\b', 'feet long'), (r'\bfootradius\b', 'foot radius'),
        (r'\bfeetwide\b', 'feet wide'), (r'\bfeettall\b', 'feet tall'),
        (r'\b1minute\b', '1 minute'), (r'\b10feet\b', '10 feet'),
        (r'\b15feet\b', '15 feet'), (r'\b20feet\b', '20 feet'),
        (r'\b30feet\b', '30 feet'), (r'\b60feet\b', '60 feet'),
        (r'\bthal\b', 'that'), (r'\bThal\b', 'That'),
        (r'\bwilh\b', 'with'), (r'\bcrealure\b', 'creature'),
        (r'\bleveI\b', 'level'), (r'\bLevel(?=or\b)', 'Level '),
        (r'\blt\b', 'It'), (r'\blfyou\b', 'If you'),
        (r'\blf\b', 'If'), (r'\bIr\b', 'If'),
        (r'\bYott\b', 'you'), (r'\bYOllr\b', 'your'), (r'\bYOll\b', 'you'),
        (r'\bVou\b', 'You'), (r'\bVour\b', 'Your'),
    ]
    for pat, rep in joined:
        text = re.sub(pat, rep, text, flags=re.I if pat not in (r'\bThal\b',) else 0)
    text=re.sub(r'PART\s*\.?\s*3\s*(?:I|\||/)?\s*S[A-Z.\[\]\' ]*PELLS?', ' ', text, flags=re.I)
    text=re.sub(r'\bPART\s*3\b', ' ', text, flags=re.I)
    for a,b in phrase.items(): text=text.replace(a,b)
    text=word_re.sub(fix_token,text)
    # a second phrase pass catches phrases exposed by token repair
    for a,b in phrase.items(): text=text.replace(a,b)
    text=re.sub(r'\s+([,.;:!?])',r'\1',text)
    text=re.sub(r'([.!?])(?=[A-Z])',r'\1 ',text)
    text=re.sub(r'\s{2,}',' ',text).strip()
    return text

# Source-extraction bleed or especially mangled blocks are clearer as faithful-enough gameplay paraphrases.
overrides={

    'Revivify': {
      'description':'You touch a creature that died within the last minute. It returns to life with 1 hit point. This spell cannot return a creature that died of old age, and it cannot restore missing body parts.',
      'higher_level':'',
    },
    'Waterwalk': {
      'description':'Up to ten willing creatures you can see within range can move across liquid surfaces - including water, acid, mud, snow, quicksand, or lava - as though they were harmless solid ground for the duration. A creature can still take damage from a hazardous surface such as molten lava. If you target a creature submerged in liquid, it rises toward the surface at 60 feet per round.',
      'higher_level':'',
    },
    'Grasping Vine': {
      'description':'You conjure a vine in an unoccupied space you can see. When you cast the spell, and as a bonus action on later turns, you can make the vine lash at a creature within 30 feet of it. The target makes a Dexterity saving throw and is pulled 20 feet directly toward the vine on a failure.',
      'higher_level':'',
    },
    'Druidcraft': {
      'description':'You create one small nature-themed magical effect within range: predict the local weather for the next 24 hours with a harmless sensory sign, make a flower bloom or seed pod open, create a brief harmless sensory effect such as leaves, wind, an animal sound, or a skunk-like odour, or instantly light or extinguish a candle, torch, or small campfire.',
      'higher_level':'',
    },
    'Ensnaring Strike': {
      'description':'The next time you hit a creature with a weapon attack before the spell ends, thorny vines appear around it. The target makes a Strength saving throw or becomes restrained. A Large or larger creature has advantage on the save. While restrained, it takes 1d6 piercing damage at the start of each turn. The target or a creature that can reach it can use an action to make a Strength check against your spell save DC, freeing it on a success.',
      'higher_level':'Using a higher-level spell slot increases the recurring piercing damage by 1d6 for each slot level above 1st.',
    },
    'Planar Binding': {
      'description':'You attempt to bind a celestial, elemental, fey, or fiend to your service. The creature must remain within range for the entire casting time, after which it makes a Charisma saving throw. On a failure it is bound to serve you for the spell\'s duration and follows your instructions to the best of its ability, although a hostile creature may try to twist your commands. If another spell summoned or created the creature, that spell\'s duration is extended to match this one.',
      'higher_level':'Higher-level slots greatly increase the binding duration, up to a year and a day with a 9th-level slot.',
    },
    'Tsunami': {
      'description':'A massive wall of water appears at a point you choose within range. Creatures in its area make a Strength saving throw, taking heavy bludgeoning damage on a failure or half on a success. On later turns the wall moves away from you, carrying and battering creatures in its path while gradually shrinking and dealing less damage. Creatures caught inside can attempt to swim out with a Strength (Athletics) check against your spell save DC.',
      'higher_level':'',
    },
    'Find Familiar': {
      'description': 'You summon a spirit that takes the form of a small animal you choose. The familiar uses the statistics of that animal, but it is a celestial, fey, or fiend rather than a beast. It acts independently but obeys your commands and cannot normally attack. You can communicate with it telepathically within 100 feet, temporarily perceive through its senses, dismiss and resummon it, and use it to deliver your touch spells if it is close enough to the target.',
      'higher_level':'',
    },
    'Greater Invisibility': {
      'description': 'You or a creature you touch becomes invisible for the duration. Anything the target is wearing or carrying is also invisible while it remains on the target’s person.',
      'higher_level':'',
    },
    'Sunburst': {
      'description': 'Brilliant sunlight flashes in a wide area centered on a point you choose. Creatures in the area make a Constitution saving throw, taking heavy radiant damage and becoming blinded on a failure, or taking half damage without being blinded on a success. Undead and oozes have disadvantage on the save. The burst also dispels magical darkness in its area.',
      'higher_level':'',
    },
    'Control Water': {
      'description': 'You control freestanding water in a large cube for the duration. Each turn you can maintain or change between four effects: raise water to create a flood, part water to create a trench, redirect flowing water in an unusual direction, or form a whirlpool that pulls creatures and objects toward its center. The exact effect depends on the body of water and ends when you choose another option or the spell ends.',
      'higher_level':'',
    },
    'Programmed Illusion': {
      'description': 'You create an illusion of an object, creature, or other visible phenomenon that remains dormant until a condition you specify occurs nearby. You decide how the illusion looks, sounds, and behaves for up to 5 minutes when triggered. After it finishes, it becomes dormant again and can trigger later. Physical interaction reveals the image as an illusion, and a creature can examine it with an Intelligence (Investigation) check against your spell save DC.',
      'higher_level':'',
    },
    'Legend Lore': {
      'description': 'Name or describe a person, place, or object. You receive a brief summary of significant lore about it, which may include current stories, forgotten tales, or secret information. The subject must be of legendary importance. The more you already know, the more precise the information tends to be, although the answer may be phrased figuratively.',
      'higher_level':'',
    },
    'Confusion': {
      'description': 'Creatures in a 10-foot-radius sphere must make a Wisdom saving throw. Affected creatures cannot take reactions and behave unpredictably at the start of each turn: they may move randomly, do nothing, attack a nearby creature, or act normally. An affected creature repeats the Wisdom save at the end of each of its turns, ending the effect on a success.',
      'higher_level':'Using a higher-level slot increases the radius of the affected area.',
    },
    'Wall of Stone': {
      'description': 'A nonmagical wall of solid stone appears at a point you choose within range. You shape it from connected stone panels and can use it to make barriers, bridges, ramps, or other simple structures. Creatures enclosed by the wall can react to move out of the way. The wall can be damaged like an object. If you maintain concentration for the full duration, the wall becomes permanent.',
      'higher_level':'',
    },
    'Minor Illusion': {
      'description': 'You create either a sound or an image of an object within range for the duration. A sound can vary from a whisper to a scream, while an image must fit within a 5-foot cube and cannot produce other sensory effects. Physical interaction reveals an image as unreal. A creature can examine the illusion with an Intelligence (Investigation) check against your spell save DC.',
      'higher_level':'',
    },
    'Invisibility': {
      'higher_level':'Using a higher-level spell slot lets you target one additional creature for each slot level above 2nd.',
    },
    'Scorching Ray': {
      'higher_level':'Using a higher-level spell slot creates one additional ray for each slot level above 2nd.',
    },
}

for s in spells:
    if s.get('sourceShort') != 'PHB 2014':
        continue
    for f in ['casting_time','range','material','duration','description','higher_level','summary']:
        s[f]=polish(str(s.get(f,'') or ''))
    if s['name'] in overrides:
        s.update(overrides[s['name']])
    s['desc']=[s['description']] if s.get('description') else []
    if s.get('description'):
        bits=re.split(r'(?<=[.!?])\s+',s['description'])
        summary=' '.join(bits[:2]).strip()
        if len(summary)>430: summary=summary[:427].rsplit(' ',1)[0]+'…'
        s['summary']=summary

P.write_text(json.dumps(spells,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('Polished',len(spells),'spells')
