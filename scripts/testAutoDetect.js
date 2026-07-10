/**
 * Test auto-detection vs manual list
 * Verifies that auto-detection catches all missing poses
 * 
 * Usage: node scripts/testAutoDetect.js
 */

const fs = require('fs');
const path = require('path');

const L2D_PATH = path.join(__dirname, '../public/assets/l2d');

// Get all character IDs from l2d.js
const getAllCharacterIds = () => {
  const l2dPath = path.join(__dirname, '../src/utils/json/l2d.js');
  const content = fs.readFileSync(l2dPath, 'utf-8');
  
  const idMatches = content.match(/'id':\s*'([^']+)'/g);
  if (!idMatches) return new Set();
  
  const ids = new Set(idMatches.map(m => m.match(/'id':\s*'([^']+)'/)[1]));
  return ids;
};

// Get the manual list from l2d.js
const getManualList = () => {
  const l2dPath = path.join(__dirname, '../src/utils/json/l2d.js');
  const content = fs.readFileSync(l2dPath, 'utf-8');
  
  // Extract the charactersWithoutAimAndCover array
  const match = content.match(/export const charactersWithoutAimAndCover = \[([\s\S]*?)\];/);
  if (!match) return new Set();
  
  const listContent = match[1];
  const ids = listContent.match(/'([^']+)'/g);
  if (!ids) return new Set();
  
  return new Set(ids.map(id => id.replace(/'/g, '')));
};

// Check if character has pose files
const checkCharacterPose = (characterId, poseType) => {
  const possiblePaths = [
    path.join(L2D_PATH, `${characterId}_${poseType}`),
    path.join(L2D_PATH, characterId, poseType)
  ];
  
  for (const dir of possiblePaths) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const files = fs.readdirSync(dir);
      if (files.some(f => f.endsWith('.skel'))) {
        return true;
      }
    }
  }
  
  return false;
};

// Check skillcut with fallback
const checkCharacterSkillcut = (characterId) => {
  if (checkCharacterPose(characterId, 'skillcut')) {
    return true;
  }
  
  const baseCharacterId = characterId.split('_')[0];
  if (baseCharacterId !== characterId) {
    if (checkCharacterPose(baseCharacterId, 'skillcut')) {
      return true;
    }
  }
  
  return false;
};

// Run tests
const runTests = () => {
  console.log('🔍 Testing Auto-Detection vs Manual List\n');
  
  const allCharacterIds = getAllCharacterIds();
  const manualList = getManualList();
  
  console.log(`Total characters: ${allCharacterIds.size}`);
  console.log(`Manual list size: ${manualList.size}\n`);
  
  // Auto-detect missing poses
  const autoDetected = new Set();
  
  for (const characterId of allCharacterIds) {
    const hasAim = checkCharacterPose(characterId, 'aim');
    const hasCover = checkCharacterPose(characterId, 'cover');
    const hasSkillcut = checkCharacterSkillcut(characterId);
    
    if (!hasAim || !hasCover || !hasSkillcut) {
      autoDetected.add(characterId);
    }
  }
  
  console.log(`Auto-detected missing: ${autoDetected.size}\n`);
  
  // Compare
  const missingFromAuto = new Set([...manualList].filter(x => !autoDetected.has(x)));
  const missingFromManual = new Set([...autoDetected].filter(x => !manualList.has(x)));
  
  let issuesFound = false;
  
  if (missingFromAuto.size > 0) {
    console.log('⚠️  MANUAL LIST HAS ITEMS NOT DETECTED:');
    for (const id of missingFromAuto) {
      const hasAim = checkCharacterPose(id, 'aim');
      const hasCover = checkCharacterPose(id, 'cover');
      const hasSkillcut = checkCharacterSkillcut(id);
      console.log(`  - ${id} (aim: ${hasAim ? '✓' : '✗'}, cover: ${hasCover ? '✓' : '✗'}, skillcut: ${hasSkillcut ? '✓' : '✗'})`);
    }
    console.log();
    issuesFound = true;
  }
  
  if (missingFromManual.size > 0) {
    console.log('⚠️  AUTO-DETECT FOUND ITEMS NOT IN MANUAL LIST:');
    for (const id of missingFromManual) {
      const hasAim = checkCharacterPose(id, 'aim');
      const hasCover = checkCharacterPose(id, 'cover');
      const hasSkillcut = checkCharacterSkillcut(id);
      console.log(`  - ${id} (aim: ${hasAim ? '✓' : '✗'}, cover: ${hasCover ? '✓' : '✗'}, skillcut: ${hasSkillcut ? '✓' : '✗'})`);
    }
    console.log();
    issuesFound = true;
  }
  
  if (!issuesFound) {
    console.log('✅ PERFECT MATCH! Manual list and auto-detection agree!\n');
    console.log('🎯 You can safely DELETE the manual list and use auto-detection only.');
  } else {
    console.log('\n❌ Mismatches found. Review above and update manual list if needed.');
  }
};

try {
  runTests();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
