const convertL2dData = (groups) => {
  const allCharacters = Object.entries(groups).flatMap(([group, characters]) => characters.map(([id, name, soundStr, zoomStr]) => {
    const obj = { group, name, id }
    if (soundStr && soundStr !== '') {
      soundStr.split('|').forEach(part => {
        const [type, values] = part.split(':')
        if (type === 'ac' && values) obj.ac = values
        if (type === 're' && values) obj.re = values})}
    if (zoomStr && typeof zoomStr === 'string') {
      const zoomConfig = {}
      zoomStr.split('|').forEach(part => {
        const [pose, values] = part.split(':')
        const [zoom, offsetX, offsetY] = values.split(',').map(Number)
        zoomConfig[pose] = { zoom: zoom || 0.21, offsetX: offsetX || 0, offsetY: offsetY || 0 }})
      if (Object.keys(zoomConfig).length > 0) obj.zoom = zoomConfig}
    return obj}))

  const charMap = Object.fromEntries(allCharacters.map(c => [c.id, c]))
  allCharacters.forEach(char => {
    const match = char.id.match(/^(.+?)_(\d+|0[0-9a-z]+|old|80)$/)
    if (match) {
      const baseChar = charMap[match[1]]
      if (baseChar?.zoom) {
        if (!char.zoom) char.zoom = { ...baseChar.zoom }
        else if (baseChar.zoom.sc && !char.zoom.sc) char.zoom.sc = { ...baseChar.zoom.sc }}}})
  return allCharacters}

// code, name, actionFx|reloadFx (track, d=delayMs o=overlay%, time), fullbody|skillcut (zoom, offsetX, offsetY)
const l2dGroups = {
  '777': [
    ['c270', 'Blanc', '', 'sc:0.49,-200,490'],
    ['c270_01', 'Blanc White Rabbit', 'ac:3d15'],
    ['c270_02', 'Blanc No.77 Batter', 'ac:3d5,3o12'],
    ['c270_03', 'Blanc Fortune Express', 'ac:1d5,1o11,2o1,4d10', 'sc:0.2'],
    ['c271', 'Noir', 'ac:2d5', 'sc:0.34,0,100'],
    ['c271_01', 'Noir Black Rabbit', 'ac:3d5,5d5'],
    ['c271_02', 'Noir Baseball Cheerleader'],
    ['c272', 'Rouge', 'ac:1d5|re:1d500,2d500', 'sc:0.24,0,50'],
    ['c272_01', 'Rouge Unlucky Rabbit', 'ac:2d10,3d3', 'fb:0.28,0,50|sc:0.24,0,50'],
  ],

  'A.C.P.U.': [
    ['c030', 'Poli', 're:1d400,2d200', 'fb:0,80|sc:0.36,0,30'],
    ['c030_01', 'Poli Sweet Holic'],
    ['c030_02', 'Poli Cheer Up Police', 'ac:2o5,4o8'],
    ['c032', 'Miranda', 'ac:1d5|re:1d5,2d200', 'sc:0.23,0,60'],
    ['c032_01', 'Miranda Thief of Justice', 'ac:1d5,1o9'],
    ['c033', 'Quiry', 'ac:2d4|re:1d500', 'sc:0.27,0,150'],
    ['favorite_c030', 'Poli@Favorite', '', 'fb:0.24,60'],
    ['favorite_c032', 'Miranda@Favorite', 'ac:2o5', 'fb:0.3,60'],
  ],

  'Absolute': [
    ['c090', 'Emma', 're:2d800', 'sc:0.3,0,50'],
    ['c090_01', 'Emma Color Me Red', 'ac:1d5,2o5'],
    ['c090_02', 'Emma Office Therapy', 'ac:3d5,3o10'],
    ['c091', 'Vesti', 're:1d800,2d400', 'sc:0.23,0,100'],
    ['c091_01', 'Vesti Ark Mage', 'ac:1d5,1o15,2o5,3o7', 'fb:0.23,0,-40'],
    ['c092', 'Eunhwa', 'ac:1d5|re:3d500,4d300', 'fb:0.23,0,-50|sc:0.3,0,80'],
    ['c093', 'Emma: Tactical Upgrade', '', 'sc:0.28'],
    ['c093_01', 'Emma: Tactical Upgrade Secret Therapy'],
    ['c094', 'Vesti: Tactical Upgrade', 'ac:1d5,1o10,2o5,4o5|re:1o5'],
    ['c094_01', 'Vesti: Tactical Upgrade Pure Beginner', '', 'fb:0.22,-150,-40'],
    ['c095', 'Eunhwa: Tactical Upgrade', 'ac:1d5,1o15,3o5|re:2o2', 'fb:0,0,30|sc:0.3,60'],
    ['c095_01', 'Eunhwa: Tactical Upgrade Day Off', 'ac:2o9', 'fb:0,0,30'],
  ],

  'Aegis': [
    ['c350', 'Mast', 'ac:2o5|re:3d700', 'sc:0.25,0,50'],
    ['c350_01', 'Mast A Pirate\'s Heart', 'ac:3d5,5d10'],
    ['c350_02', 'Mast the Driver'],
    ['c350_old', 'Mast: Outdated'],
    ['c351', 'Anchor', 're:2d300,3d300', 'sc:0.31'],
    ['c351_01', 'Anchor the Diver', 'ac:1d5'],
    ['c352', 'Helm', 'ac:2o5|re:1d500,3d300', 'sc:0.3,0,150'],
    ['c352_01', 'Helm Chandelier', 'ac:3d10', 'fb:0.3,0,-180'],
    ['c352_02', 'Helm Post-Shower Moment', 'ac:2d10,3d5', 'fb:0.24,0,-50|sc:0.2,0,30'],
    ['c353', 'Helm: Aquamarine', 'ac:4o9', 'sc:0.66,-500,-30'],
    ['c354', 'Mast: Romantic Maid', 're:2d500,3d300', 'sc:0.24,0,90'],
    ['c354_01', 'Mast: Romantic Maid Tea Service', 'ac:2o8,5d2', 'sc:0.23,0,20'],
    ['c355', 'Anchor: Innocent Maid', 'ac:6d5|re:2d200', 'sc:0.3,0,100'],
    ['favorite_c352', 'Helm@Favorite', 'ac:1o5,3d5,4o5', 'fb:0.34,60'],
  ],

  'Ark Rangers': [
    ['c570', 'Ark Ranger Black', 'ac:6d12|re:2o5'],
    ['c570_99', 'Ark Ranger Black: Hood'],
    ['c571', 'Ark Ranger Red', '', 'fb:0.23,0,-40'],
    ['c572', 'Ark Ranger Blue'],
  ],

  'Best Seller': [
    ['c580', 'Phantom', 'ac:1d5,1o13,3d5|re:1d300,2o5', 'sc:0.25,0,-60'],
    ['c581', 'Arcana', 'ac:2o5,6o8|re:3d200', 'sc:0.23,0,90'],
    ['c582', 'Label', '', 'sc:0.26'],
    ['c583', 'Arcana: Fortune Mate', 'ac:1d5,1o13,3o5|re:2o8,4d500', 'sc:0.27,0,10'],
  ],

  'Botanic Garden': [
    ['c411', 'Flora', 'ac:1o6,3d5|re:4d400', 'sc:0.53,-250,100'],
    ['c412', 'Trina', 'ac:4d10|re:2d800,3d500,4d200', 'sc:0.37,200'],
    ['c412_01', 'Trina Natural White', 'ac:1o5,6o8'],
  ],

  'Cafe Sweety': [
    ['c140', 'Sugar', '', 'fb:0,80'],
    ['c140_01', 'Sugar Hard-Boiled', '', 'fb:0,80'],
    ['c140_02', 'Sugar Wild Backyard', '', 'fb:0,80'],
    ['c141', 'Milk'],
    ['c141_01', 'Milk Extreme Fighter'],
    ['c142', 'Frima'],
    ['c142_01', 'Frima Sea of Sloth'],
    ['c143', 'Milk Blooming Bunny'],
    ['favorite_c141', 'Milk@Favorite', '', 'fb:0.35,60,-60'],
    ['favorite_c142', 'Frima@Favorite', '', 'fb:0.31,60,-60'],
  ],

  'Cooking Oil': [
    ['c520', 'Bready'],
    ['c520_01', 'Bready Frosty Bite'],
    ['c521', 'Crust'],
  ],

  'Counters': [
    ['c010', 'Rapi', 'ac:1d3,3d6'],
    ['c010_01', 'Rapi: Outdated', 'ac:1d3,3d6'],
    ['c010_02', 'Rapi White Promise', 'ac:1d3,3d6'],
    ['c010_03', 'Rapi Classic Vacation', 'ac:1d3'],
    ['c011', 'Neon', 'ac:1d15|re:2d400', 'sc:0.25'],
    ['c011_01', 'Neon Bling Bullet'],
    ['c012', 'Anis', 'ac:2d6,3d5|re:3d400', 'sc:0.42,0,40'],
    ['c014', 'Neon: Blue Ocean', 'ac:1d5,4d8,5d5|re:2d400', 'fb:0,0,50|sc:0.29'],
    ['c015', 'Anis: Sparkling Summer', 'ac:1d5,2d5|re:5o8', 'sc:0.6,0,520'],
    ['c016', 'Rapi: Red Hood', '', 'sc:0.25'],
    ['c016_01', 'Rapi: Red Hood Red Flavor', 'ac:2d5,2o3,6d5', 'fb:0.23,0,20|sc:0.27'],
    ['c016_02', 'Rapi: Red Hood Cherished Red', 'ac:2d5,3d5', 'sc:0.28,0,-60'],
    ['c016_03', 'Rapi: Red Hood Shining Light', 'ac:4d5'],
    ['c017', 'Anis: Star', 'ac:2o5,4o5|re:2o5', 'fb:0.23,0,-50|sc:0.3,0,200'],
    ['c017_01', 'Anis: Starlight', 'ac:1o5,3o8', 'fb:0.26,0,-80|sc:0.25'],
    ['c017_02', 'Anis: Star T.T.STAR', 'ac:1o1,6d3,7d5'],
    ['c018', 'Neon: Vision Eye', 'ac:2o5,3o4,4o6,6d35o2,7o3|re:2o5', 'fb:0.23|sc:0.25'],
    ['c989', 'Rapi: Red'],
    ['c990', 'Rapi: Minor'],
    ['c992', 'Rapi: Child'],
    ['c994', 'Rapi: Origin'],
    ['c9019', 'Neon: Child'],
  ],

  'Dazzling Pear': [
    ['c450', 'Naga'],
    ['c450_01', 'Naga Elegant Date'],
    ['c450_02', 'Naga Last Girlhood', '', 'fb:0.25,0,-70'],
    ['c450_03', 'Naga Ring Ensemble'],
    ['c451', 'Tia'],
    ['c451_01', 'Tia Lovely Date'],
    ['c451_02', 'Tia Sweet Chef'],
    ['c451_03', 'Tia Sea Lizzie', '', 'fb:0.23,0,-30'],
  ],

  'Electric Shock': [
    ['c500', 'Elegg'],
    ['c501', 'Trony'],
    ['c501_01', 'Trony Sweet Step'],
    ['c502', 'Elegg: Boom and Shock'],
  ],

  'Exotic': [
    ['c110', 'Crow'],
    ['c111', 'Jackal'],
    ['c111_01', 'Jackal Class Troublemaker'],
    ['c112', 'Viper'],
    ['c112_01', 'Viper Toxic Rabbit'],
    ['c112_02', 'Viper Shine of Love', '', 'fb:0.25,0,-70'],
    ['c112_03', 'Viper Punky Street'],
    ['c113', 'E.H.'],
    ['c113_01', 'E.H. Junkyard Vanguard'],
    ['c940', 'E.H.: Origin'],
    ['favorite_c112', 'Viper@Favorite', '', 'fb:0.28,60'],
  ],

  'Extrinsic': [
    ['c180', 'Guillotine'],
    ['c180_01', 'Guillotine Dark Tracer'],
    ['c181', 'Maiden'],
    ['c181_01', 'Maiden Covert Nurse'],
    ['c181_02', 'Maiden Under the Sun'],
    ['c182', 'Guillotine Winter Slayer', '', 'fb:0.22,70,-30'],
    ['c183', 'Maiden Ice Rose', '', 'fb:0.23'],
  ],

  'Four Beasts': [
    ['c560', 'Behemoth'],
    ['c561', 'Ziz'],
    ['c562', 'Leviathan'],
    ['c563', 'Bahamut'],
    ['c996', 'Leviathan: Origin'],
  ],

  'Goddess': [
    ['c224', 'Snow White: Innocent Days'],
    ['c225', 'Scarlet: Black Shadow', '', 'fb:0.27,0,-110'],
    ['c225_01', 'Scarlet: Black Shadow Longing Flower', '', 'fb:0.25,0,-40'],
    ['c226', 'Rapunzel: Pure Grace'],
    ['c233', 'Dorothy'],
    ['c233_01', 'Dorothy Nostalgia'],
    ['c233_02', 'Dorothy Luna Light'],
    ['c233_80', 'Dorothy (CN)', '', 'fb:0.23,0,-30'],
    ['c234', 'Dorothy: Serendipity', '', 'fb:0.26,0,-10'],
    ['c470', 'Red Hood'],
    ['c470_01', 'Red Hood Nonsense Red'],
    ['c470_02', 'Red Hood Retro Days'],
    ['c943', 'Liliweiss'],
    ['c966', 'Rapunzel: Pure'],
  ],

  'Hammer & Drill': [
    ['c490', 'Hammering'],
    ['c491', 'Drilley'],
  ],

  'Happy Zoo': [
    ['c380', 'Nero', '', 'fb:0.27'],
    ['c381', 'Biscuit'],
    ['c381_01', 'Biscuit Spring Puppy'],
    ['c382', 'Leona'],
    ['c382_01', 'Leona Zoo Keeper'],
  ],

  'Heavy Gram': [
    ['c361', 'T.A.L.O.S', '', 'fb:0.23'],
    ['c977', 'Kilo'],
  ],

  'Incubator': [
    ['c590', 'Mori'],
  ],

  'Infinity Rail': [
    ['c070', 'Brid'],
    ['c070_01', 'Brid Model Worker'],
    ['c070_02', 'Brid Black Moon'],
    ['c071', 'Soline'],
    ['c072', 'Diesel'],
    ['c072_01', 'Diesel Black Sunday'],
    ['c072_02', 'Diesel Strawberry Flower'],
    ['c072_04', 'Diesel Midnight Strawberry'],
    ['c073', 'Brid: Silent Track'],
    ['c074', 'Soline: Frost Ticket'],
    ['c075', 'Diesel: Winter Sweets'],
    ['favorite_c072', 'Diesel@Favorite', '', 'fb:0.27,60'],
  ],

  'Inherit': [
    ['c230', 'Harran'],
    ['c230_01', 'Harran Banquet Witch', '', 'fb:0,0,-30'],
    ['c231', 'Isabel', '', 'fb:0.25'],
    ['c231_01', 'Isabel Honeymoon Party'],
    ['c232', 'Noah'],
  ],

  'Liaozhai': [
    ['c8004', 'Ying Ning'],
    ['c8005', 'Hua Pi'],
    ['c8006', 'Ying Ning Fox'],
  ],

  'M.M.R.': [
    ['c290', 'Mana'],
    ['c291', 'Ether'],
    ['c321', 'Marciana'],
    ['c321_01', 'Marciana School Days'],
    ['c322', 'Marciana: Marine Study'],
  ],

  'Maid For You': [
    ['c310', 'Ade'],
    ['c310_01', 'Ade Maid in Spring'],
    ['c311', 'Cocoa'],
    ['c312', 'Soda'],
    ['c313', 'Privaty: Unkind Maid'],
    ['c314', 'Soda: Twinkling Bunny'],
    ['c315', 'Ade: Agent Bunny'],
    ['c316', 'Velvet'],
    ['c316_01', 'Velvet: Sensual Rabbit'],
  ],

  'Master Hand': [
    ['c150', 'Julia'],
    ['c150_01', 'Julia Mild Nocturne'],
    ['c150_02', 'Julia Summer Romance'],
    ['favorite_c150', 'Julia@Favorite'],
  ],

  'Matis': [
    ['c100', 'Laplace'],
    ['c101', 'Drake'],
    ['c101_01', 'Drake Villain Racer'],
    ['c101_02', 'Drake Maid For Vilian'],
    ['c102', 'Maxwell'],
    ['c102_01', 'Maxwell Mechanic White'],
    ['c103', 'Laplace: Ultimate Hero', 'ac:1o8,2o2,3o2,5d45|re:1o1,2o8'],
    ['c103_01', 'Laplace: Prototype Hero', 'ac:2o6'],
    ['c104', 'Drake: Upgrade'],
    ['c105', 'Maxwell: Ordinary Mechanic', 'ac:3d15,5d5,6d5|re:2o6'],
    ['c105_01', 'Maxwell: Chief Researcher', 'ac:3d5'],
    ['c9029', 'Laplace: Child'],
    ['favorite_c100', 'Laplace@Favorite'],
    ['favorite_c101', 'Drake@Favorite'],
  ],

  'Mighty Tools': [
    ['c080', 'Centi'],
    ['c080_01', 'Centi Supreme Holiday'],
    ['c080_02', 'Centi Ocean Repair'],
    ['c082', 'Liter'],
    ['c082_01', 'Liter Guardfish'],
    ['c082_02', 'Liter Cute Sunflower'],
    ['c082_80', 'Liter (CN)'],
  ],

  'Nepenthe': [
    ['c240', 'Rumani'],
    ['c241', 'Epinel'],
    ['c242', 'Folkwang'],
    ['c242_01', 'Folkwang Moist Bunny'],
  ],

  'Old Tales': [
    ['c510', 'Grave'],
    ['c511', 'Anachiro | Cinderella', 'ac:3o6,6o3,7o5', 'fb:0.25,100,0|sc:0.25,0,40'],
    ['c511_01', 'Anachiro | Cinderella Glass Princess', '', 'fb:0.23,0,20|sc:0.22,0,20'],
    ['c511_02', 'Anachiro | Cinderella Beautiful Me', 'ac:2d6,3d4'],
    ['c513', 'Little Mermaid | Siren', 'ac:1o7,3o8', 'sc:0.3'],
    ['c513_01', 'Little Mermaid | Siren Abyss Flower', 'ac:1d3,1o8,3d3,3o8', 'fb:0.28,0,20|sc:0.3,0,-40'],
    ['c513_02', 'Little Mermaid | Siren Beautiful Bubble'],
    ['c513_03', 'Little Mermaid | Siren Shell Princess', 'ac:1o9,3d16,3o15'],
    ['c514', 'Grave the Great', 'ac:3d5|re:2o3,3o3,4o3,5o6', 'sc:0.34,0,100'],
    ['c514_01', 'Grave the Great Beautiful You', 'ac:3d5'],
    ['c515', 'Anachiro | Cinderella: Crystal Wave', 'ac:4o6,6d5|re:2o6,3o3', 'fb:0,50,0|sc:0.37,0,-40'],
    ['c944', 'Anachiro', 'ac:3o6,6o3,7o5', 'fb:0.25,100'],
    ['c979', 'Grave: Abe'],
    ['c980', 'Hansel'],
    ['c981', 'Gretel'],
    ['c982', 'Red Shoes'],
  ],

  'Over the Horizon': [
    ['c530', 'Sky'],
    ['c531', 'Cielo'],
    ['c532', 'Sora'],
    ['c532_01', 'Sora Spring Flight'],
  ],

  'Overseer': [
    ['c440', 'Eyeri'],
    ['c441', 'Avista'],
  ],

  'Pathfinder': [
    ['c480', 'Liveryn'],
    ['c481', 'Fragile'],
  ],

  'Perilous Siege': [
    ['c040', 'D'],
    ['c041', 'K'],
    ['c041_01', 'K: Undercover'],
    ['c043', 'D: Killer Wife'],
    ['c043_01', 'D: Killer Wife Secret Party Cleaner'],
    ['c043_02', 'D: Killer Wife Secret Police'],
  ],

  'Pioneer': [
    ['c220', 'Snow White'],
    ['c220_01', 'Snow White White Knight'],
    ['c221', 'Rapunzel'],
    ['c222', 'Scarlet'],
    ['c222_01', "Scarlet: Racer's High"],
    ['c223', 'Nayuta'],
    ['c223_01', 'Nayuta: Wu Wei'],
    ['c227', 'Pinocchio'],
    ['c471', 'Snow White: Heavy Arms'],
    ['c9008', 'Nayuta Clone'],
  ],

  'Prima Donna': [
    ['c430', 'Noise'],
    ['c430_01', 'Noise Cherry Blossom Stage'],
    ['c430_02', 'Noise Classic Diva'],
    ['c431', 'Volume'],
    ['c431_01', 'Volume Beat the Gun'],
    ['c432', 'Aria'],
  ],

  'Protocol': [
    ['c210', 'Exia'],
    ['c210_01', 'Exia Joy to the Nerds'],
    ['c210_02', 'Exia Gamer'],
    ['c210_03', 'Exia Hacker Rabbit'],
    ['c212', 'Novel'],
    ['c212_01', 'Novel Penguin Holmes'],
    ['c212_02', 'Novel Detective Nurse'],
    ['favorite_c210', 'Exia@Favorite'],
  ],

  'Real Kindness': [
    ['c400', 'Guilty'],
    ['c400_01', 'Guilty Wave of Disbelief'],
    ['c401', 'Sin'],
    ['c401_01', 'Sin Backstreet Dream'],
    ['c402', 'Quency'],
    ['c403', 'Quency Escape Queen'],
    ['c403_01', 'Quency Escape Queen Masquerade Swan'],
  ],

  'Recall & Release': [
    ['c120', 'N102'],
    ['c121', 'Anne: Miracle Fairy'],
  ],

  'Rewind': [
    ['c550', 'Bay'],
    ['c550_01', 'Bay Radiant Rabbit'],
    ['c551', 'Clay'],
    ['c551_01', 'Clay Cheer Up Training'],
    ['favorite_c550', 'Bay@Favorite'],
  ],

  'School Circle': [
    ['c390', 'Zwei'],
    ['c390_01', 'Zwei First Festa'],
    ['c390_02', 'Zwei Spring Stroll'],
    ['c391', 'Ein'],
    ['c391_01', 'Ein Handmade Festa'],
    ['c392', 'Rei'],
  ],

  'Seraphim': [
    ['c130', 'Mary'],
    ['c130_01', 'Mary Medical Rabbit'],
    ['c131', 'Pepper'],
    ['c131_01', 'Pepper Ocean Vitamin'],
    ['c132', 'Mary: Bay Goddess'],
  ],

  'Shade': [
    ['c9004', 'Velvet'],
  ],

  'T.T. STAR': [
    ['c600', 'Mint: Star'],
    ['c600_01', 'Mint'],
    ['c600_02', 'Mint: Training'],
    ['c601', 'Prika: Star'],
    ['c601_01', 'Prika'],
    ['c601_02', 'Prika: Training'],
    ['c9021', 'Anis'],
    ['c9021_01', 'Anis: Training'],
  ],

  Talentum: [
    ['c200', 'Rupee'],
    ['c200_01', 'Rupee Rabbit Deluxe'],
    ['c201', 'Yan'],
    ['c201_01', 'Yan Sunrise Market'],
    ['c202', 'Dolla'],
    ['c202_01', 'Dolla Dark Rose'],
    ['c203', 'Rupee: Winter Shopper'],
  ],

  'The Carronades': [
    ['c060', 'Belorta'],
    ['c061', 'Mica'],
    ['c062', 'Mica: Snow Buddy'],
  ],

  'The Scouts': [
    ['c020', 'Delta'],
    ['c022', 'Signal'],
    ['c022_01', 'Signal Dramatic Chocolate'],
    ['c023', 'Delta: Ninja Thief'],
  ],

  Triangle: [
    ['c170', 'Privaty'],
    ['c170_01', 'Privaty Government Grunt'],
    ['c170_02', 'Privaty Banquet Princess'],
    ['c170_03', 'Privaty Destined in Blue'],
    ['c170_04', 'Privaty Sharp Lesson'],
    ['c171', 'Yulha'],
    ['c172', 'Admi'],
  ],

  'Underworld Queen': [
    ['c280', 'Rosanna'],
    ['c280_01', 'Rosanna Ms. Dangerous'],
    ['c281', 'Moran'],
    ['c281_01', 'Moran Off-Duty Queen'],
    ['c281_02', 'Moran King of Flowers'],
    ['c282', 'Sakura'],
    ['c282_01', 'Sakura Midnight Stealth'],
    ['c283', 'Rosanna: Chic Oceon'],
    ['c284', 'Sakura: Bloom in Summer'],
  ],

  Unlimited: [
    ['c190', 'Ludmilla'],
    ['c191', 'Alice'],
    ['c191_01', 'Alice Sweet Home'],
    ['c191_02', 'Alice Märchen Dream'],
    ['c192', 'Tove'],
    ['c192_01', 'Tove Baseball Fan'],
    ['c192_02', 'Tove Sunblaze'],
    ['c193', 'Neve'],
    ['c194', 'Ludmilla: Winter Owner'],
    ['c195', 'Alice: Wonderland Bunny'],
    ['favorite_c192', 'Tove@Favorite'],
  ],

  'Veiled Order': [
    ['c620', 'Snow Crane'],
  ],

  Wardress: [
    ['c160', 'Yuni'],
    ['c160_01', 'Yuni Pretty In Pink'],
    ['c161', 'Mihara'],
    ['c162', 'Mihara: Upgrade'],
    ['c162_01', 'Mihara: Upgrade Paint Eater'],
    ['c985', 'Yuni: Upgrade'],
  ],

  'White Knight': [
    ['c330', 'Crown'],
    ['c330_01', 'Crown Naked King'],
    ['c330_02', 'Crown Glorious Flower'],
    ['c331', 'Chime'],
  ],

  _AI: [
    ['c370', 'Eternity'],
    ['c371', 'Endless'],
    ['c928', 'Einkk'],
    ['c904', 'Enikk'],
  ],

  _Ark: [
    ['c610', 'Mekami Shifty'],
    ['c905', 'Rian'],
    ['c907', 'Shifty'],
    ['c907_01', 'Shifty_old'],
    ['c908', 'Papillon'],
    ['c973', 'Jien'],
    ['c9032', 'Jien: Child'],
  ],

  _CEO: [
    ['c900', 'Ingrid'],
    ['c901', 'Syuen', 'ac:1d10,2d5,3d9'],
    ['c902', 'Mustang'],
    ['c902_01', 'Mustang (CN)'],
    ['c9022', 'Mustang: Origin'],
    ['c9023', 'Mustang: Hanson'],
    ['c9030', 'Enme'],
    ['c9031', 'Syuen: Child'],
  ],

  _Commander: [
    ['c903', 'Andersen'],
    ['c903_01', 'Andersen Soaked'],
    ['c914', 'Burningum'],
    ['c939', 'Doban'],
    ['c942', 'Commander (GODDESS)'],
    ['c961', 'Oswald'],
    ['c961_01', 'Oswald Casual'],
  ],

  _Eden: [
    ['c925', 'Johan'],
    ['c929', 'Cecil'],
  ],

  _Heretic: [
    ['c013', 'Modernia: Marian'],
    ['c260', 'Modernia'],
    ['c260_01', 'Modernia First Affection'],
    ['c260_02', 'Modernia Second Affection'],
    ['c260_80', 'Modernia (CN)'],
    ['c261', 'Nihilister'],
    ['c262', 'Liberalio'],
    ['c262_01', 'Liberalio Dreaming Lake'],
    ['c263', 'Indivilia'],
    ['c997', 'Only One'],
    ['c9009', 'Nihilister Hood'],
    ['c9014', 'Mass-Produced Heretic'],
    ['c9017', 'Altruia'],
    ['c9025', 'Egovista'],
  ],

  _Melee: [
    ['c965', 'Scarlet'],
    ['c971', 'Rose'],
    ['c971_01', 'Rose: Mirror'],
    ['c974', 'zMelee'],
    ['c974_01', 'zMelee 2'],
  ],

  _Npc: [
    ['c482', 'Logey'],
    ['c934', 'Angelina'],
    ['c935', 'Joseph'],
    ['c941', 'Pinne'],
    ['c960', 'Freesia: Child'],
    ['c970', 'Lumi'],
    ['c983', 'Nadia'],
    ['c991', 'D.E.E.P'],
    ['c9001', 'Spirit Pinne'],
    ['c9002', 'Nora'],
    ['c9003', 'Mrs. Miss'],
    ['c9006', 'Deipara'],
    ['c9016', 'V.T.C. Priestess'],
    ['c9018', 'Princess'],
    ['c9020', 'Freesia: Star'],
    ['c9020_01', 'Freesia'],
    ['c9024', 'Yoyo'],
    ['c9026', 'Amy'],
    ['c9028', 'Hope'],
  ],

  _Other: [
    ['c250', 'Mass Produced: Red'],
    ['c251', 'Mass Produced: Blue'],
    ['c252', 'Mass Produced: Orange'],
    ['c253', 'Mass Produced: Green'],
    ['c254', 'Mass Produced: Purple'],
    ['c255', 'Mass Produced: White'],
    ['c300', 'Replace: Soldier EG'],
    ['c301', 'Replace: Soldier FA'],
    ['c302', 'Replace: Product 08'],
    ['c303', 'Replace: Product 12'],
    ['c304', 'Replace: iDoll Flower'],
    ['c305', 'Replace: iDoll Ocean'],
    ['c306', 'Replace: Soldier OW'],
    ['c307', 'Replace: Product 23'],
    ['c308', 'Replace: iDoll Sun'],
    ['c910', 'Hologram'],
    ['c910_01', 'Hologram: Sweet Johnny'],
    ['c911', 'Faceless Gentlemen'],
    ['c912', 'Faceless Lady'],
    ['c915', 'Robot: Raptillion'],
    ['c916', 'Faceless NPC 01'],
    ['c917', 'Faceless NPC 02'],
    ['c918', 'Faceless NPC 03'],
    ['c919', 'Faceless NPC 04'],
    ['c920', 'Faceless NPC 05'],
    ['c921', 'Faceless NPC 06'],
    ['c922', 'Faceless NPC 07'],
    ['c923', 'Faceless NPC 08'],
    ['c924', 'Faceless NPC 09'],
    ['c930', 'Animal: Beatrice'],
    ['c931', 'Robot: Roam'],
    ['c931_01', 'Robot: Com'],
    ['c932', 'Animal: Bolt Junior'],
    ['c933', 'Animal: Bolt'],
    ['c936', 'Animal: Max'],
    ['c937', 'Animal: Booboo'],
    ['c945', 'Robot: Katie'],
    ['c946', 'Animal: Ruru'],
    ['c947', 'Faceless NPC 10'],
    ['c948', 'Faceless NPC 11'],
    ['c951', 'Faceless NPC 12'],
    ['c952', 'Faceless NPC 13'],
    ['c962', 'Replace: Product 12 B-0006'],
    ['c963', 'Replace: Product 12 C-1002'],
    ['c964', 'Replace: Product 12 6000-D'],
    ['c967', 'Spirit: Lumi'],
    ['c968', 'Spirit: Lua'],
    ['c969', 'Spirit: Lena'],
    ['c975', 'Animal: Timi'],
    ['c976', 'Hologram: T.Rony'],
    ['c988', 'Faceless Chloe - Village Guardian'],
    ['c993', 'Robot: Mecha Shifty'],
    ['c9000', 'Ghost Alfred'],
    ['c9000_01', 'Ghost Neaty'],
    ['c9000_02', 'Ghost Sizzly'],
    ['c9000_03', 'Ghost Fixy'],
    ['c9000_05', 'Ghost Detaily'],
    ['c9000_06', 'Ghost Sellsy'],
    ['c9000_07', 'Ghost'],
    ['c9015', 'Faceless NPC 14'],
    ['c9034', 'Penguin No.1'],
    ['c9035', 'Penguin No.2'],
    ['c9036', 'Penguin No.3'],
    ['c9037', 'Penguin No.4'],
    ['azxservicetime_1', 'AZX: Soline 1'],
    ['azxservicetime_2', 'AZX: Soline 2'],
    ['azxservicetime_4', 'AZX: Diesel 1'],
    ['azxservicetime_5', 'AZX: Diesel 2'],
    ['azxservicetime_7', 'AZX: Brid 1'],
    ['azxservicetime_8', 'AZX: Brid 2'],
    ['smol_anis', 'Smol: Anis'],
    ['smol_ade', 'Smol: Ade'],
    ['smol_anchor', 'Smol: Anchor'],
    ['smol_anchor_pirate', 'Smol: Anchor Pirate'],
    ['smol_bolt', 'Smol: Bolt'],
    ['smol_emilia', 'Smol: Emilia'],
    ['smol_frima', 'Smol: Frima'],
    ['smol_helm', 'Smol: Helm'],
    ['smol_liter', 'Smol: Liter'],
    ['smol_mary', 'Smol: Mary'],
    ['smol_mast', 'Smol: Mast'],
    ['smol_mast_pirate', 'Smol: Mast Pirate'],
    ['smol_mpriv', 'Smol: Maid Privaty'],
    ['smol_mint', 'Smol: Mint'],
    ['smol_pepper', 'Smol: Pepper'],
    ['smol_prika', 'Smol: Prika'],
    ['smol_ram', 'Smol: Ram'],
    ['smol_rapi', 'Smol: Rapi'],
    ['smol_rem', 'Smol: Rem'],
    ['smol_sin_pirate', 'Smol: Sin Pirate'],
    ['smol_yan', 'Smol: Yan'],
  ],

  '__Collab Airborne Squad': [
    ['c850', 'EVE'],
    ['c850_01', 'EVE Keyhole Dress'],
    ['c850_02', 'EVE Neurolink Suit'],
    ['c850_03', 'EVE Skin Suit', '', 'fb:0.25'],
    ['c851', 'Raven Keyhole Dress'],
    ['c851_01', 'Raven Planet Diving Suit (6th) V2'],
    ['c851_02', 'Raven Midsummer Alice'],
    ['c852', 'Lily'],
    ['c853', 'Adam'],
    ['c998', 'Hermin'],
  ],

  '__Collab B.S.T.': [
    ['c840', 'Ada'],
    ['c840_01', 'Ada Seperate Ways'],
    ['c840_02', 'Ada Dress'],
    ['c841', 'Jill'],
    ['c841_01', 'Jill Classic'],
    ['c841_02', 'Jill Battle Suit'],
    ['c842', 'Claire'],
  ],

  '__Collab Café LycoReco': [
    ['c860', 'Chisato'],
    ['c860_01', 'Chisato DA Training Wear (First)'],
    ['c860_02', 'Chisato Red Spark Guitar'],
    ['c861', 'Takina'],
    ['c861_01', 'Takina DA Training Wear (Second)'],
    ['c861_02', 'Takina Blue Pulse Bass'],
    ['c862', 'Kurumi'],
    ['c9010', 'Jane'],
    ['c9011', 'Rain'],
  ],

  '__Collab Devil Hunter': [
    ['c800', 'Makima'],
    ['c800_01', 'Makima Coat Off'],
    ['c801', 'Power'],
    ['c802', 'Himeno'],
    ['c803', 'Denji'],
    ['c803_01', 'Denji Chainsaw Man'],
    ['c804', 'Aki Hayakawa'],
  ],

  "__Collab Emilia's Faction": [
    ['c820', 'Rem'],
    ['c820_01', 'Rem Handy Maid'],
    ['c820_02', 'Rem Pure Blossom'],
    ['c821', 'Emilia'],
    ['c821_01', 'Emilia Clumsy Maid'],
    ['c821_02', 'Emilia Spring Breeze'],
    ['c822', 'Ram'],
  ],

  '__Collab NERV': [
    ['c830', 'Asuka Shikinami'],
    ['c830_01', 'Asuka Shikinami School Uniform'],
    ['c830_02', 'Asuka Shikinami Cynical Street'],
    ['c830_03', 'Asuka Shikinami Test Plugsuit'],
    ['c831', 'Rei Ayanami'],
    ['c831_01', 'Rei Ayanami School Uniform'],
    ['c831_02', 'Rei Ayanami Peaceful Vacation'],
    ['c832', 'Mari Makinami'],
    ['c832_01', 'Mari Makinami School Uniform'],
    ['c832_02', 'Mari Makinami Leisure Travel'],
    ['c832_03', 'Mari Makinami Final Battle'],
    ['c832_04', 'Mari Makinami Mystery Muse'],
    ['c833', 'Misato Katsuragi'],
  ],

  '__Collab WILLE': [
    ['c834', 'Rei Ayanami Tentative Name'],
    ['c834_01', 'Rei Ayanami Miss Lookalike from Village-3'],
    ['c834_02', 'Rei Ayanami Soul Connect'],
    ['c835', 'Asuka Shikinami WILLE'],
    ['c835_01', 'Asuka Shikinami Final Battle'],
    ["c835_02", "Asuka Shikinami Ocean's Lament"],
    ['c836', 'Sakura Suzuhara'],
  ],

  '__Collab YoRHa': [
    ['c810', '2B'],
    ['c810_01', '2B Metamorphic Damage'],
    ['c810_02', '2B YoRHa Uniform 1'],
    ['c810_03', '2B Unofficial Waterfront Gear 1'],
    ['c811', 'A2'],
    ['c811_01', 'A2 Metamorphic Damage'],
    ['c811_02', 'A2 YoRHa Uniform Prototype'],
    ['c811_03', 'A2 Unofficial Waterfront Gear Prototype'],
    ['c812', 'Pascal'],
    ['c813', '9S'],
  ],

  '__Event': [
    ['nocallerid', 'No Caller ID'],
    ['hightechtoy', 'Hightech Toy'],
    ['miraclesnow', 'Miracle Snow'],
    ['brandnewyear', 'Brand New Year'],
    ['doutsider', 'D Outsider'],
    ['maidinvalentine', 'Maid in Valentine'],
    ['bowwowparadise', 'Bow Wow Paradise'],
    ['cherryblossom', 'Cherry Blossom'],
    ['ltk', 'License to Kill'],
    ['whitememory1', 'White Memory 1'],
    ['whitememory2', 'White Memory 2'],
    ['777', 'Bunny x 777'],
    ['queensorder', 'Queen\'s Order'],
    ['bluewaterisland', 'Blue Water Island'],
    ['nyanyaparadise', 'Nya Nya Paradise'],
    ['goldenship', 'Golden Ship'],
    ['seayouagain', 'Sea, You Again'],
    ['outerautomata', 'OuteR: Automata'],
    ['schooloflock', 'School Of Lock'],
    ['dazzlingcupid_tia', 'Dazzling Cupid: Tia'],
    ['dazzlingcupid_naga', 'Dazzling Cupid: Naga'],
    ['acpufreeze', 'A.C.P.U.! FREEZE!'],
    ['redash1', 'RED ASH 1'],
    ['redash2', 'RED ASH 2'],
    ['alonesurvivor', 'Alone Survivor'],
    ['neverland', 'Neverland'],
    ['newyearnewsword', 'New Year New Sword'],
    ['lionheart', 'Lion Heart'],
    ['dirtybackyard', 'Dirty Backyard'],
    ['perfectmaid', 'Perfect Maid'],
    ['boomsday', 'BOOM\'s DAY'],
    ['killthelord', 'Kill The Lord'],
    ['recipeforyou', 'Re:Cipe For You'],
    ['piratecafe', 'Pirate Cafe'],
    ['onemoretime', 'One More Time'],
    ['lastkingdom', 'Last Kingdom'],
    ['darkhero', 'D.ARK HERO'],
    ['goldencoinrush', 'Golden Coin Rush'],
    ['claymore', 'Claymore!'],
    ['aegisthediver', 'Aegis the Diver'],
    ['beautyfullshot', 'Beauty Full Shot'],
    ['juveniledays', 'Juvenile Days'],
    ['colorless', 'Color Less'],
    ['jinxplayer', 'Jinx Player'],
    ['phantomthief', 'Phantom Thief Detective'],
    ['lifeagain', 'Life Again'],
    ['oldtales', 'Old Tales', '', 'fb:0.52'],
    ['secretgarden', 'Secret Garden'],
    ['icedragonsaga', 'Ice Dragon Saga'],
    ['footstepwalkrun', 'Footstep, Walk, Run'],
    ['wisdomspring', 'Wisdom Spring'],
    ['romanticvalentine', 'Romantic Valentine'],
    ['evangelion', 'Evangelion'],
    ['forrest', 'For Rest'],
    ['newflavor', 'New Flavor'],
    ['trueflavor', 'True Flavor'],
    ['unbreakablesphere', 'Unbreakable Sphere'],
    ['arcanearchive', 'Arcana Archive'],
    ['lordforjustice', 'Lord, for Justice'],
    ['memoriesteller_1', 'Memories Teller 1'],
    ['memoriesteller_2', 'Memories Teller 2'],
    ['overthehorizon', 'Over the Horizon'],
    ['boomtheghost', 'Boom the Ghost!'],
    ['secondquest1', 'Evangelion: Second Quest 1'],
    ['secondquest2', 'Evangelion: Second Quest 2'],
    ['absolute', 'Absolute'],
    ['coinsinrush', 'Coins In Rush'],
    ['rebornevil', 'Reborn Evil'],
    ['goninjathief', 'Go! Ninja Thief'],
    ['blankticket', 'Blank Ticket'],
    ['terminusticket', 'Terminus Ticket'],
    ['azxservicetime_3', 'Terminus Ticket AZX: Soline'],
    ['azxservicetime_6', 'Terminus Ticket AZX: Diesel'],
    ['azxservicetime_9', 'Terminus Ticket AZX: Brid'],
    ['arkguardian', 'Ark Guardian'],
    ['sineditor', 'Sin Editor'],
    ['fatalmaid', 'Fatal Maid'],
    ['liecauserecoil', 'Lie Cause Recoil'],
    ['enterheaven', 'Enter Heaven'],
    ['twoxtwo1', '2x2 Love 1'],
    ['twoxtwo2', '2x2 Love 2'],
    ['goodworld', 'Good World'],
    ['staranis', 'Star Anis', '', 'fb:0.35,100'],
    ['bsideidol', 'B-side Idol'],
    ['bitterspice', 'Bitter Spice'],
    ['arkranger', 'Ark Ranger'],
    ['projectmatis', 'Project Matis'],
  ],

  '__Story': [
    ['story0001', 'Story 00-01'],
    ['story0001_2', 'Story 00-01 no filter'],
    ['story0002', 'Story 00-02'],
    ['story0002_2', 'Story 00-02 no filter'],
    ['story0003', 'Story 00-03'],
    ['story0201', 'Story 02-01'],
    ['story0401', 'Story 04-01'],
    ['story0401_2', 'Story 04-02'],
    ['story0401_3', 'Story 04-02 (CN)'],
    ['story0405', 'Story 04-05'],
    ['story0702', 'Story 07-02'],
    ['story1201', 'Story 12-01'],
    ['story1302', 'Story 13-02'],
    ['story1303', 'Story 13-03'],
    ['story1401', 'Story 14-01'],
    ['story1403', 'Story 14-03'],
    ['story1405', 'Story 14-05'],
    ['story1501', 'Story 15-01'],
    ['story1902', 'Story 19-01'],
    ['story2002', 'Story 20-01'],
    ['story2101', 'Story 21-01'],
    ['story2201', 'Story 22-01'],
    ['story2202', 'Story 22-02'],
    ['story2206', 'Story 22-06'],
    ['story2501', 'Story 25-01'],
    ['story2602', 'Story 26-02'],
  ],

  '__z': [
    ['bba001', 'Boss: Mother Whale'],
    ['bbg001', 'Boss: Harvester'],
    ['bbg002', 'Boss: Chatterbox'],
    ['bbg003', 'Boss: Blacksmith'],
    ['c9005', 'Predator'],
    ['c9005_01', 'Predator: leader'],
    ['eba001', 'Boss: Storm Bringer'],
    ['eba003', 'Boss: Gatekeeper Blue'],
    ['eba003_green', 'Boss: Gatekeeper Green'],
    ['eba003_hsta', 'Boss: Gatekeeper Red'],
    ['ebg001', 'Boss: Land Eater'],
    ['ebg002', 'Boss: Material H'],
    ['mba002', 'Boss: Nihilister'],
    ['mbg001', 'Boss: Alteisen'],
    ['mbg002', 'Boss: Grave Digger'],
    ['mbg004', 'Boss: Modernia'],
    ['mbg004_appearance', 'Boss: Modernia Intro'],
  ],
}

//share voice
const voiceGroupOverrides = {
  'c010': ['c010_01', 'c010_02', 'c010_03'],
  'c011': ['c011_01'],
  'c016': ['c016_03'],
  'c030': ['c030_01', 'c030_02'],
  'c032': ['c032_01'],
  'c070': ['c070_01', 'c070_02'],
  'c072': ['c072_01', 'c072_02', 'c072_04'],
  'c090': ['c090_02'],
  'c091': ['c091_01'],
  'c093': ['c093_01'],
  'c095': ['c095_01'],
  'c105': ['c105_01'],
  'c111': ['c111_01'],
  'c112': ['c112_01'],
  'c140': ['c140_01', 'c140_02'],
  'c141': ['c141_01'],
  'c142': ['c142_01'],
  'c180': ['c180_01'],
  'c181': ['c181_01', 'c181_02'],
  'c271': ['c271_01', 'c271_02'],
  'c350': ['c350_01', 'c350_old'],
  'c352': ['c352_01'],
  'c381': ['c381_01'],
  'c382': ['c382_01'],
  'c412': ['c412_01'],
  'c450': ['c450_01', 'c450_03'],
  'c451': ['c451_01', 'c451_02'],
  'c501': ['c501_01'],
  'c511': ['c511_02', 'c944'],
  'c513': ['c513_02'],
  'c851': ['c851_01'], 
}

//click motion especially for sub model
const specialClickAnimations = {
  'c011': ['expression_0'],
  'c016_01': ['expression_1'],
  'c490': ['smile'],
  'c491': ['angry'],
  'c513_03': ['expression_0'],
  'c560': ['special'],
  'c561': ['delight'],
  'c562': ['special'],
  'c563': ['etc'],
  'c570_99': ['think'],
  'c571': ['pain'],
  'c572': ['angry'],
  'c989': ['special'],
  'c990': ['sad'],
  'c992': ['angry'],
  'c994': ['angry_02'],
  'c412_01': ['expression_0'],
  'c940': ['sad'],
  'c943': ['surprise'],
  'c966': ['pain_02'],
  'c973': ['smile'],
  'c977': ['surprise'],
  'c996': ['special_02'],
  'c9018': ['delight'],
  'c9019': ['delight'],
  'c9028': ['special'],
  'c9030': ['delight'],
  'c9031': ['pain'],
  'c9032': ['smile'],
}

//chara have foreground and background
const charactersWithFgBgOverlays = [
  'c513_03', 
  'c515',
  'c103', 'c105', 'c017_01', 'c017_02',
]

//skillcut special default motion if not name as "idle"
const skillcutAnimationOverrides = {
  'c010': 'Idle',
  'c010_01': 'Idle',
  'c010_02': 'Idle',
  'c010_03': 'Idle',
  'c030': 'Idle',
  'c030_01': 'Idle',
  'c030_02': 'Idle',
  'c094': 'idle_2',
  'c094_01': 'idle_2',
  'c513_03': 'idle_all',
  'c570': 'idle_0',
  'c582': 'idle_0',
  'c583': 'idle_all',
  'c570_99': 'idle_0',
}

//skillcut click if other than skillcut_all, skillcut_0, skillcut_1, skill_cut
const skillcutConfig = {
  c016: {animations: ['skillcut_2'],},
  c016_03: {animations: ['skillcut_2'],},
  c094: {animations: ['skillcut_2_OFF_MOVE_BIG'],},
  c094_01: {animations: ['skillcut_2_OFF_MOVE_BIG'],},
}

const l2dData = convertL2dData(l2dGroups)
const customZoomSettings = Object.fromEntries(l2dData.filter(c => c.zoom).map(c => [c.id, c.zoom]))

//action overlap or delay
const actionSoundConfig = {}
l2dData.forEach(char => {
  if (char.ac) {
    const config = {}
    // Parse string format: "1d3,3d6" -> { 1: { delay: 3 }, 3: { delay: 6 } }
    char.ac.split(',').forEach(item => {
      const match = item.match(/(\d+)([do])(\d+)/)
      if (match) {
        const [, actionId, type, value] = match
        if (!config[actionId]) config[actionId] = {}
        if (type === 'd') config[actionId].delay = parseInt(value)
        if (type === 'o') config[actionId].overlap = parseInt(value)
      }
    })
    actionSoundConfig[char.id] = config
  }
})

//reload overlap or delay
const reloadSoundConfig = {}
l2dData.forEach(char => {
  if (char.re) {
    const config = {}
    // Parse string format: "1o1,2o8" -> { 1: { overlap: 1 }, 2: { overlap: 8 } }
    char.re.split(',').forEach(item => {
      const match = item.match(/(\d+)([do])(\d+)/)
      if (match) {
        const [, actionId, type, value] = match
        if (!config[actionId]) config[actionId] = {}
        if (type === 'd') config[actionId].delay = parseInt(value)
        if (type === 'o') config[actionId].overlap = parseInt(value)
      }
    })
    reloadSoundConfig[char.id] = config
  }
})

export const charactersWithoutAimAndCover = []

const setCustomZoom = (characterId, canvas, transformScale, currentPose) => {
  // Get the zoom settings for this character
  let characterSettings = customZoomSettings[characterId]
  
  // If variant doesn't have settings, try base character ONLY for skillcut
  if (!characterSettings && characterId.includes('_') && currentPose === 'skillcut') {
    const baseCharacterId = characterId.split('_')[0]
    characterSettings = customZoomSettings[baseCharacterId]
  }
  
  if (!characterSettings) {
    if (canvas) {
      canvas.dataset.baseLeft = ''
      canvas.dataset.baseTop = ''
    }
    return transformScale
  }

  // Handle new format: { fb: {...}, sc: {...}, a: {...}, c: {...} }
  let settings
  if (characterSettings.fb || characterSettings.sc || characterSettings.a || characterSettings.c) {
    // New format with pose-specific settings
    let poseKey = currentPose
    // Map pose names to short keys
    if (currentPose === 'skillcut') poseKey = 'sc'
    else if (currentPose === 'aim') poseKey = 'a'
    else if (currentPose === 'cover') poseKey = 'c'
    
    settings = characterSettings[poseKey]
  } else {
    // Old format: direct settings (assumed to be fullbody)
    settings = characterSettings
  }

  if (!settings) {
    if (canvas) {
      canvas.dataset.baseLeft = ''
      canvas.dataset.baseTop = ''
    }
    return transformScale
  }

  transformScale = settings.zoom * 1.4

  if (canvas) {
    canvas.style.transform = 'scale(' + transformScale + ')'

    if (!canvas.dataset.baseLeft) {
      canvas.dataset.baseLeft = canvas.style.left || '0px'
      canvas.dataset.baseTop = canvas.style.top || '0px'
    }

    const baseLeft = parseInt(canvas.dataset.baseLeft.replaceAll('px', '')) || 0
    const baseTop = parseInt(canvas.dataset.baseTop.replaceAll('px', '')) || 0

    canvas.style.left = (baseLeft + (settings.offsetX || 0)) + 'px'
    canvas.style.top = (baseTop + (settings.offsetY || 0)) + 'px'
  }

  return transformScale
}

// Since voices are now in public/assets, we need to build the voice map differently
// We'll generate URLs dynamically for each character based on the known structure
const voiceMap = {}

// Helper function to generate voice URLs dynamically
// Attempts to detect naming patterns by checking files in the voice folder
const generateVoiceUrls = (voiceFolderId) => {
  const normal = []
  const cover = []
  const skillcut = []
  
  // Normal voices: Lobby/Touch naming
  // Format: {id}_Lobby_Touch_1-3.ogg, {id}_Lobby_Touch_Love_1-3.ogg
  for (let i = 1; i <= 3; i++) {
    normal.push(`/assets/l2d/${voiceFolderId}/voice/${voiceFolderId}_Lobby_Touch_${i}.ogg`)
    normal.push(`/assets/l2d/${voiceFolderId}/voice/${voiceFolderId}_Lobby_Touch_Love_${i}.ogg`)
  }
  
  // Cover/aim pose voices: Reload naming
  // Format: {id}_Reload_1-6.ogg
  for (let i = 1; i <= 6; i++) {
    cover.push(`/assets/l2d/${voiceFolderId}/voice/${voiceFolderId}_Reload_${i}.ogg`)
  }
  
  // Skillcut voices - primary and cutscene
  skillcut.push(`/assets/l2d/${voiceFolderId}/voice/${voiceFolderId}_Ult_Skill_1.ogg`)
  skillcut.push(`/assets/l2d/${voiceFolderId}/voice/${voiceFolderId}_ult_cutscene.ogg`)
  
  return { normal, cover, skillcut }
}

// Build voiceMap from l2dData with dynamic URL construction
l2dData.forEach((character) => {
  const characterId = character.id
  
  // Check if this character is in a voice group override
  let voiceFolderId = characterId
  for (const [baseId, variants] of Object.entries(voiceGroupOverrides)) {
    if (Array.isArray(variants) && variants.includes(characterId)) {
      voiceFolderId = baseId
      break
    }
  }
  
  // Generate voice URLs for this character
  const voices = generateVoiceUrls(voiceFolderId)
  voiceMap[characterId] = {
    normal: voices.normal,
    cover: voices.cover,
    skillcut: voices.skillcut
  }
})

export { voiceMap, voiceGroupOverrides, setCustomZoom, customZoomSettings, specialClickAnimations, actionSoundConfig, reloadSoundConfig, charactersWithFgBgOverlays, skillcutAnimationOverrides, skillcutConfig }
export default l2dData