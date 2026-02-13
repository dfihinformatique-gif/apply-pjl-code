/**
 * Test du parsing des modifications de l'article 2
 * 
 * À placer dans : packages/tisseuse/src/lib/text_parsers/modifications.test.ts
 * 
 * Pour lancer : npm test modifications.test.ts
 */

import { describe, expect, test } from 'vitest';
import { TextParserContext } from './parsers.js';
import { reference } from './references.js';
import { action } from './actions.js';
import type { TextAstReference, TextAstAction } from './ast.js';

describe('Parse modifications from Article 2 - PLF 2026', () => {
  
  test('Parse: La seconde phrase du dernier alinéa du II', () => {
    const text = `La seconde phrase du dernier alinéa du II de l'article 224 du code général des impôts`;
    
    const context = new TextParserContext(text);
    const result = reference(context) as TextAstReference;
    
    expect(result).toBeDefined();
    console.log('\n=== PARSED REFERENCE ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n=== REMAINING TEXT ===');
    console.log('Remaining:', context.remaining());
  });
  
  test('Parse: est remplacée par trois alinéas', () => {
    const text = `est remplacée par trois alinéas ainsi rédigés`;
    
    const context = new TextParserContext(text);
    const result = action(context) as TextAstAction;
    
    expect(result).toBeDefined();
    expect(result.action).toBe('MODIFICATION');
    console.log('\n=== PARSED ACTION ===');
    console.log(JSON.stringify(result, null, 2));
  });
  
  test('Parse: Après le III, il est inséré', () => {
    const text = `Après le III, il est inséré un III bis ainsi rédigé`;
    
    const context = new TextParserContext(text);
    const result = action(context) as TextAstAction;
    
    expect(result).toBeDefined();
    expect(result.action).toBe('CREATION');
    console.log('\n=== PARSED ACTION (insertion) ===');
    console.log(JSON.stringify(result, null, 2));
  });
  
  test('Parse: Le A du IV est remplacé', () => {
    const text = `Le A du IV`;
    
    const context = new TextParserContext(text);
    const result = reference(context) as TextAstReference;
    
    expect(result).toBeDefined();
    console.log('\n=== PARSED REFERENCE (A du IV) ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('\nShould be parent-enfant with:');
    console.log('- parent: division type IV');
    console.log('- child: division type A');
  });
  
  test('Full sentence: La seconde phrase du dernier alinéa du II ... est remplacée', () => {
    const fullText = `La seconde phrase du dernier alinéa du II de l'article 224 du code général des impôts est remplacée par trois alinéas ainsi rédigés : « En cas de modification... »`;
    
    // Parse en deux temps : référence puis action
    const context1 = new TextParserContext(fullText);
    const ref = reference(context1);
    
    console.log('\n=== FULL SENTENCE PARSING ===');
    console.log('Reference parsed:', ref ? 'YES' : 'NO');
    if (ref) {
      console.log('Reference:', JSON.stringify(ref, null, 2));
      console.log('Remaining after reference:', context1.remaining().slice(0, 50) + '...');
    }
    
    // Parser l'action sur le reste
    if (ref && context1.remaining().trim().startsWith('est')) {
      const context2 = new TextParserContext(context1.remaining().trim());
      const act = action(context2);
      
      console.log('\nAction parsed:', act ? 'YES' : 'NO');
      if (act) {
        console.log('Action:', JSON.stringify(act, null, 2));
      }
    }
  });
  
  test('Understand TextAstReference structure', () => {
    // Ce test sert à documenter la structure de l'AST
    const text = `du dernier alinéa du II`;
    
    const context = new TextParserContext(text);
    const result = reference(context) as any;
    
    console.log('\n=== AST STRUCTURE EXPLANATION ===');
    console.log('Input:', text);
    console.log('\nExpected structure:');
    console.log('parent-enfant {');
    console.log('  parent: parent-enfant {');
    console.log('    parent: division (II)');
    console.log('    child: portion (dernier alinéa)');
    console.log('  }');
    console.log('  // Note: "du" creates parent-child relationship');
    console.log('}');
    console.log('\nActual result:');
    console.log(JSON.stringify(result, null, 2));
  });
});
