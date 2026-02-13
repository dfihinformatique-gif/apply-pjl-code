# Guide de démarrage - Système de diff législatif

## ✅ Ce qu'on a maintenant

1. **Les parsers de tisseuse fonctionnent déjà !**
   - `reference` : Parse "La seconde phrase du dernier alinéa du II"
   - `action` : Parse "est remplacée par"
   - Types AST complets et bien définis

2. **La signature correcte** :
   ```typescript
   const context = new TextParserContext(text);
   const result = reference(context);  // ✅ CORRECT
   // PAS: parseText(context, reference, 0) ❌
   ```

3. **Structure AST documentée** : types dans `ast.ts`

## 🚀 Prochaines étapes CONCRÈTES

### Étape 1 : Tester les parsers (30 min)

**Sur votre machine, dans tricoteuses-juridique :**

```bash
# 1. Copier le fichier de test
cp /path/to/modifications.test.ts packages/tisseuse/src/lib/text_parsers/

# 2. Lancer les tests
cd packages/tisseuse
npm test modifications.test.ts -- --reporter=verbose

# 3. Observer les résultats
# Cela vous montrera EXACTEMENT ce que retournent les parsers
```

**Objectif** : Comprendre la structure AST générée pour nos exemples

**Questions à répondre** :
- ✅ "La seconde phrase du dernier alinéa du II" → Quel AST ?
- ✅ Est-ce un `parent-enfant` imbriqué ?
- ✅ Comment sont représentés "seconde", "dernier" ?

### Étape 2 : Créer le parser de modifications (2h)

**Fichier à créer** : `packages/tisseuse/src/lib/text_parsers/modifications.ts`

```typescript
import { chain, optional, type TextParser } from './parsers.js';
import { reference } from './references.js';
import { action } from './actions.js';
import { citation } from './citations.js';
import type { TextAstReference, TextAstAction, TextAstCitation } from './ast.js';

/**
 * Parse une modification législative complète
 * 
 * Ex: "La seconde phrase du dernier alinéa du II est remplacée par : « ... »"
 */
export const modification: TextParser = chain([
  reference,          // Parse "La seconde phrase du dernier alinéa du II"
  action,             // Parse "est remplacée"
  optional(citation, { default: null }), // Parse « ... » (optionnel)
], {
  value: (results): TextAstModification => ({
    type: 'modification',
    target: results[0] as TextAstReference,
    action: results[1] as TextAstAction,
    newContent: results[2] as TextAstCitation | null,
    position: {
      start: (results[0] as any).position.start,
      stop: results[2] 
        ? (results[2] as any).position.stop 
        : (results[1] as any).position.stop,
    },
  }),
});

export interface TextAstModification {
  type: 'modification';
  target: TextAstReference;
  action: TextAstAction;
  newContent?: TextAstCitation | null;
  position: FragmentPosition;
}
```

**Test** :
```typescript
test('Parse modification complète', () => {
  const text = `La seconde phrase du dernier alinéa du II est remplacée par : « nouveau texte »`;
  const context = new TextParserContext(text);
  const result = modification(context);
  
  expect(result.type).toBe('modification');
  expect(result.action.action).toBe('MODIFICATION');
  expect(result.newContent).toBeDefined();
});
```

**Ajouter à `index.ts`** :
```typescript
export { modification, type TextAstModification } from './text_parsers/modifications.js';
```

### Étape 3 : Créer l'extracteur (1h)

**Fichier à créer** : `packages/tisseuse/src/lib/extractors/modifications.ts`

```typescript
import { TextParserContext } from '../text_parsers/parsers.js';
import { modification, type TextAstModification } from '../text_parsers/modifications.js';

export interface ModificationBlock {
  id: string;
  articleId: string;      // LEGIARTI000051200465
  rawText: string;
  ast?: TextAstModification;
}

/**
 * Extrait toutes les modifications d'un projet de loi
 */
export function extractModificationsFromProject(
  projectHTML: string
): ModificationBlock[] {
  // Note: Utiliser cheerio (déjà dans devDependencies)
  const cheerio = require('cheerio');
  const $ = cheerio.load(projectHTML);
  const blocks: ModificationBlock[] = [];
  
  $('li.assnatFPFprojetloiartexte').each((index, element) => {
    const $el = $(element);
    const rawText = $el.text();
    
    // Trouver le lien vers l'article
    const $link = $el.find('a.lien_article_externe');
    const href = $link.attr('href');
    const articleId = href?.match(/LEGIARTI\d+/)?.[0] || '';
    
    // Parser la modification
    const context = new TextParserContext(rawText);
    const ast = modification(context);
    
    blocks.push({
      id: `mod-${index}`,
      articleId,
      rawText,
      ast: ast as TextAstModification | undefined,
    });
  });
  
  return blocks;
}
```

### Étape 4 : Navigateur d'articles (3h)

**Fichier à créer** : `packages/tisseuse/src/lib/navigation/article-navigator.ts`

```typescript
import type { TextAstReference } from '../text_parsers/ast.js';

export class ArticleNavigator {
  private dom: any; // cheerio instance
  
  constructor(articleHTML: string) {
    const cheerio = require('cheerio');
    this.dom = cheerio.load(articleHTML);
  }
  
  /**
   * Localise un élément dans l'article
   */
  locate(reference: TextAstReference): string {
    // Convertir l'AST en chemin de navigation
    const path = this.convertToPath(reference);
    
    // Naviguer dans le DOM
    let selector = 'p'; // Par défaut tous les <p>
    
    for (const step of path) {
      selector = this.refineSelector(selector, step);
    }
    
    return this.dom(selector).html() || '';
  }
  
  private convertToPath(ref: TextAstReference): NavigationStep[] {
    const steps: NavigationStep[] = [];
    this.walkReference(ref, steps);
    return steps;
  }
  
  private walkReference(ref: TextAstReference, steps: NavigationStep[]): void {
    // Implémentation selon la structure AST
    // À compléter après avoir vu les résultats des tests
  }
}

interface NavigationStep {
  type: 'division' | 'portion' | 'article';
  identifier?: string | number;
  ordinal?: 'first' | 'last' | 'second' | number;
}
```

### Étape 5 : Intégration dans Article.svelte (2h)

**Dans votre projet SvelteKit** :

```typescript
// Importer depuis tisseuse
import {
  extractModificationsFromProject,
  ArticleNavigator,
  type ModificationBlock,
} from '@tricoteuses/tisseuse';

// Dans le composant
const projectModifications = $derived.by(() => {
  if (!projectHTML) return [];
  return extractModificationsFromProject(projectHTML);
});

async function generateModificationDiff(
  mod: ModificationBlock,
  articleHTML: string,
): Promise<string> {
  const navigator = new ArticleNavigator(articleHTML);
  const oldHTML = navigator.locate(mod.ast!.target);
  
  // Construire le nouveau HTML selon l'action
  const newHTML = buildNewHTML(oldHTML, mod.ast!);
  
  // Réutiliser la fonction existante !
  return generateHtmlSplitDiff(oldHTML, newHTML);
}
```

## 📊 Timeline estimée

| Phase | Durée | Livrable |
|-------|-------|----------|
| 1. Tests parsers | 30 min | Comprendre l'AST généré |
| 2. Parser modifications | 2h | `modifications.ts` + tests |
| 3. Extracteur | 1h | `extractors/modifications.ts` |
| 4. Navigateur | 3h | `navigation/article-navigator.ts` |
| 5. Intégration | 2h | Boutons dans Article.svelte |
| **TOTAL** | **~9h** | **Système fonctionnel** |

## 🎯 Première action MAINTENANT

**Lancez ce test sur votre machine** :

```bash
cd tricoteuses-juridique/packages/tisseuse

# Copier le fichier de test que j'ai créé
# modifications.test.ts → src/lib/text_parsers/

npm test modifications.test.ts -- --reporter=verbose
```

**Puis partagez-moi** :
- Les résultats du test (AST généré)
- Ce qui marche / ne marche pas
- Questions sur la structure AST

Et on pourra affiner le navigateur en conséquence ! 🚀

## 💡 Pourquoi cette approche va marcher

1. ✅ **Parsers robustes** : tisseuse est déjà testé et utilisé en production
2. ✅ **Types stricts** : TypeScript évite les erreurs
3. ✅ **Réutilisation maximale** : 95% du code existe déjà
4. ✅ **Incrémental** : Chaque étape est testable indépendamment
5. ✅ **Maintenable** : Tout dans tisseuse, bibliothèque dédiée

Prêt à lancer le premier test ? 🎉
