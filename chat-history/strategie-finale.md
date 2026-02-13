# Stratégie finale : Diffs de projets de loi avec tisseuse

## 🎯 Vision d'ensemble

Nous allons **étendre tisseuse** pour supporter le parsing complet des modifications législatives, puis **intégrer dans Article.svelte** pour afficher les diffs.

## ✅ Ce qui existe déjà dans tisseuse

### 1. Parsers de base (`text_parsers/`)

**actions.ts** - Parse les actions :
```typescript
action → TextAstAction {
  action: "CREATION" | "MODIFICATION" | "SUPPRESSION" | "CREATION_OU_MODIFICATION"
  originalCitations?: TextAstCitation[]  // Le nouveau texte entre « »
}
```

**Patterns supportés :**
- ✅ "est remplacé" / "sont remplacés"
- ✅ "est inséré" / "sont insérés"
- ✅ "est complété"
- ✅ "est abrogé" / "est supprimé"
- ✅ "est ainsi rédigé"

**references.ts** - Parse les références :
```typescript
reference → TextAstReference {
  type: "article" | "division" | "portion" | "parent-enfant" | ...
  num?: string           // Numéro (224, II, A, 1°...)
  relative?: number      // Position relative
}
```

**Supporte :**
- Articles : "article 224", "l'article 6"
- Divisions : "du II", "le A du IV", "chapitre III"
- Portions : "dernier alinéa", "seconde phrase"
- Composés : "La seconde phrase du dernier alinéa du II"

### 2. Système de transformation (`text_parsers/transformers.ts`)

**Déjà utilisé dans Article.svelte :**
```typescript
import {
  simplifyHtml,
  reversePositionsSplitFromPositions,
  newReverseTransformationsMergedFromPositionsIterator,
} from '@tricoteuses/tisseuse';

// Convertit HTML → texte en gardant les positions
const transformation = simplifyHtml()(html);
const text = transformation.output;

// Retrouve les positions HTML depuis les positions texte
const htmlPositions = reversePositionsSplitFromPositions(
  transformation,
  textPositions
);
```

### 3. Extractors (`extractors/`)

**extractReferences()** - Trouve toutes les références dans un texte

## ➕ Ce qu'il faut ajouter

### Extension 1 : Parser complet des modifications

**Fichier à créer : `packages/tisseuse/src/lib/text_parsers/modifications.ts`**

```typescript
/**
 * Parse une modification législative complète
 * 
 * Ex: "La seconde phrase du dernier alinéa du II de l'article 224 
 *      est remplacée par trois alinéas ainsi rédigés : « ... »"
 */
export const modification = chain([
  reference,          // Parse la référence complète
  action,             // Parse l'action
  optional(citation), // Parse le nouveau contenu (optionnel)
], {
  value: (results): TextAstModification => ({
    type: 'modification',
    target: results[0] as TextAstReference,
    action: results[1] as TextAstAction,
    newContent: results[2] as TextAstCitation | null,
  })
});

export interface TextAstModification {
  type: 'modification';
  target: TextAstReference;    // La zone à modifier
  action: TextAstAction;       // Le type de modification
  newContent?: TextAstCitation; // Le nouveau texte
}
```

### Extension 2 : Extractor de modifications

**Fichier à créer : `packages/tisseuse/src/lib/extractors/modifications.ts`**

```typescript
import { modification } from '../text_parsers/modifications.js';
import { TextParserContext, parseText } from '../text_parsers/parsers.js';

/**
 * Extrait toutes les modifications d'un projet de loi
 */
export function extractModificationsFromProject(
  projectHTML: string
): ModificationBlock[] {
  const dom = new DOMParser().parseFromString(projectHTML, 'text/html');
  const blocks: ModificationBlock[] = [];
  
  // Pour chaque <li> du projet
  const items = dom.querySelectorAll('li.assnatFPFprojetloiartexte');
  
  items.forEach((item, index) => {
    const rawText = item.textContent || '';
    const context = new TextParserContext(rawText);
    
    // Parser la modification
    const parsed = parseText(context, modification, 0);
    
    if (parsed) {
      blocks.push({
        id: `mod-${index}`,
        rawText,
        ast: parsed,
      });
    }
  });
  
  return blocks;
}

export interface ModificationBlock {
  id: string;
  rawText: string;
  ast: TextAstModification;
}
```

### Extension 3 : Navigateur d'articles

**Fichier à créer : `packages/tisseuse/src/lib/navigation/article-navigator.ts`**

```typescript
import type { TextAstReference } from '../text_parsers/ast.js';

/**
 * Navigate dans un article HTML selon une référence AST
 */
export class ArticleNavigator {
  constructor(articleHTML: string) { /* ... */ }
  
  /**
   * Localise un élément dans l'article
   * 
   * @param reference - Référence AST (ex: "dernier alinéa du II")
   * @returns HTMLElement trouvé
   */
  locate(reference: TextAstReference): HTMLElement {
    // Convertir l'AST en chemin de navigation
    const path = this.convertToPath(reference);
    
    // Naviguer dans le DOM
    let current = this.article;
    for (const step of path) {
      current = this.navigate(current, step);
    }
    
    return current;
  }
  
  private convertToPath(ref: TextAstReference): NavigationStep[] {
    // Parcourir récursivement l'AST
    // Ex: parent-enfant "du II" → [division II, portion]
  }
  
  private navigate(scope: HTMLElement, step: NavigationStep): HTMLElement {
    // Selon le type : division, portion, article...
  }
}
```

## 🔧 Intégration dans Article.svelte

### Nouvelles fonctions à ajouter

```typescript
// Dans Article.svelte
import { 
  extractModificationsFromProject,
  ArticleNavigator,
  type ModificationBlock,
} from '@tricoteuses/tisseuse';

/**
 * Extrait et parse les modifications du projet
 */
const projectModifications = $derived.by(() => {
  if (!projectArticleHTML) return [];
  
  return extractModificationsFromProject(projectArticleHTML);
});

/**
 * Génère le diff pour une modification
 */
async function generateModificationDiff(
  modification: ModificationBlock,
  articleHTML: string,
): Promise<string> {
  
  // 1. Naviguer vers la zone ciblée
  const navigator = new ArticleNavigator(articleHTML);
  const targetElement = navigator.locate(modification.ast.target);
  
  // 2. Extraire le HTML actuel
  const oldHTML = targetElement.outerHTML;
  
  // 3. Construire le nouveau HTML
  const newHTML = buildNewHTML(
    oldHTML,
    modification.ast.action,
    modification.ast.newContent,
  );
  
  // 4. Réutiliser generateHtmlSplitDiff() existant !
  return generateHtmlSplitDiff(oldHTML, newHTML);
}

function buildNewHTML(
  oldHTML: string,
  action: TextAstAction,
  newContent?: TextAstCitation,
): string {
  switch (action.action) {
    case 'MODIFICATION':
      // Remplacer le contenu
      return extractCitationHTML(newContent);
    
    case 'CREATION':
      // Ajouter à la fin
      return oldHTML + extractCitationHTML(newContent);
    
    case 'SUPPRESSION':
      return '';
    
    default:
      return oldHTML;
  }
}

function extractCitationHTML(citation?: TextAstCitation): string {
  if (!citation) return '';
  
  // Les citations dans l'AST contiennent le texte entre guillemets
  // On peut utiliser convertCitationToText() de tisseuse
  
  // Pour l'instant :
  return '<p>' + citation.content.join('') + '</p>';
}
```

### UI : boutons pour afficher les diffs

```svelte
<!-- Dans Article.svelte -->

{#if projectModifications.length > 0}
  <section class="mt-8">
    <h3 class="text-xl font-bold mb-4">
      Modifications apportées par le projet de loi
    </h3>
    
    {#each projectModifications as modification}
      <div class="border rounded p-4 mb-4">
        <button
          class="lx-link-uppercase"
          onclick={() => toggleDiff(modification.id)}
        >
          {showDiff.has(modification.id) ? 'Masquer' : 'Voir'} les modifications
        </button>
        
        {#if showDiff.has(modification.id)}
          {#await generateModificationDiff(modification, articleHTML)}
            <p>Calcul en cours...</p>
          {:then diffHTML}
            {@html diffHTML}
          {:catch error}
            <p class="text-red-600">Erreur : {error.message}</p>
          {/await}
        {/if}
      </div>
    {/each}
  </section>
{/if}
```

## 📋 Plan d'implémentation

### Phase 1 : Tests avec les parsers existants (1 jour)

**Objectif** : Vérifier que les parsers de tisseuse peuvent parser nos exemples

```bash
# Créer un fichier de test
cd tricoteuses-juridique/packages/tisseuse/src/lib/text_parsers
cat > modifications.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';
import { TextParserContext, parseText } from './parsers.js';
import { reference } from './references.js';
import { action } from './actions.js';

describe('Parse modifications from Article 2', () => {
  it('should parse: La seconde phrase du dernier alinéa du II est remplacée', () => {
    const text = `La seconde phrase du dernier alinéa du II de l'article 224 du code général des impôts est remplacée par trois alinéas ainsi rédigés`;
    
    const context = new TextParserContext(text);
    const result = parseText(context, reference, 0);
    
    expect(result).toBeDefined();
    console.log('Parsed:', JSON.stringify(result, null, 2));
  });
  
  it('should parse: Après le III, il est inséré un III bis', () => {
    const text = `Après le III, il est inséré un III bis ainsi rédigé : « ... »`;
    
    const context = new TextParserContext(text);
    const result = parseText(context, action, 0);
    
    expect(result).toBeDefined();
    console.log('Parsed:', JSON.stringify(result, null, 2));
  });
});
EOF

# Lancer les tests
npm test modifications.test.ts
```

**Résultat attendu** : Comprendre exactement ce que retournent les parsers

### Phase 2 : Créer le parser de modifications (1 jour)

- [ ] Créer `text_parsers/modifications.ts`
- [ ] Exporter dans `index.ts`
- [ ] Tests unitaires

### Phase 3 : Créer l'extractor (1 jour)

- [ ] Créer `extractors/modifications.ts`
- [ ] Parser tout l'article 2 du projet
- [ ] Vérifier les AST générés

### Phase 4 : Créer le navigateur (2 jours)

- [ ] Créer `navigation/article-navigator.ts`
- [ ] Implémenter `locate()` pour divisions, portions
- [ ] Tests avec les articles LEGIARTI*

### Phase 5 : Intégration dans Article.svelte (1 jour)

- [ ] Importer les fonctions de tisseuse
- [ ] Créer les fonctions de génération de diff
- [ ] Ajouter l'UI avec boutons

### Phase 6 : Tests et raffinement (continu)

- [ ] Tester avec différents projets de loi
- [ ] Gérer les cas d'erreur
- [ ] Améliorer le parsing au fur et à mesure

## 🚀 Prochaine étape immédiate

**Créer le fichier de test `modifications.test.ts`** pour voir ce que retournent exactement les parsers existants sur nos exemples.

Voulez-vous que je crée ce fichier de test pour qu'on puisse le lancer et voir les résultats ?

## 📚 Ressources

- **Parsers tisseuse** : `packages/tisseuse/src/lib/text_parsers/`
- **Tests existants** : `*.test.ts` - montrent comment utiliser les parsers
- **Extractors existants** : `packages/tisseuse/src/lib/extractors/`
- **Article.svelte** : Contient déjà `generateHtmlSplitDiff()`

## 💡 Avantages de cette approche

✅ **Réutilise 95% du code existant**
✅ **Parsers robustes et testés** (tisseuse)
✅ **Système de diff déjà fonctionnel** (Article.svelte)
✅ **Extensible** : facile d'ajouter de nouveaux cas
✅ **Maintenable** : tout est dans tisseuse, bibliothèque dédiée
✅ **TypeScript strict** : types forts partout
