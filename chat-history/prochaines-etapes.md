# Prochaines étapes - Basées sur les résultats des tests

## ✅ Ce qu'on a appris

### 1. Structure AST parfaitement comprise

Pour "La seconde phrase du dernier alinéa du II de l'article 224 du CGI" :

```
parent-enfant {
  parent: texte (CGI)
  child: parent-enfant {
    parent: article 224
    child: parent-enfant {
      parent: item II (index: 2)  ⚠️ "item", pas "division" !
      child: parent-enfant {
        parent: alinéa (num: "dernier", index: -1)
        child: phrase (index: 2)  // seconde = index 2
      }
    }
  }
}
```

**Points clés** :
- ✅ "II" est un `item`, pas une `division`
- ✅ "dernier" a `index: -1` (indexation négative)
- ✅ "seconde" a `index: 2` (probablement 1-indexed : première=1, seconde=2)
- ✅ Structure `parent-enfant` imbriquée parfaitement parsée

### 2. Le parser `reference` parse AUSSI l'action !

**Découverte importante** : `reference()` retourne un `TextAstReferenceAndAction` quand il trouve une action :

```json
{
  "type": "reference_et_action",
  "reference": { /* toute la structure parent-enfant */ },
  "action": { "action": "MODIFICATION" }
}
```

**Conséquence** : On n'a PAS besoin de créer un parser `modification` séparé ! 🎉

## 🚀 Plan d'action RÉVISÉ

### Étape 1 : Créer l'extracteur de modifications (1h)

**Fichier** : `packages/tisseuse/src/lib/extractors/modifications.ts`

```typescript
import { TextParserContext } from '../text_parsers/parsers.js';
import { reference } from '../text_parsers/references.js';
import type { TextAstReference, TextAstReferenceAndAction } from '../text_parsers/ast.js';

export interface ModificationBlock {
  id: string;
  articleId: string;      // LEGIARTI000051200465
  articleNum: string;     // "224"
  rawText: string;
  ast?: TextAstReference | TextAstReferenceAndAction;
}

/**
 * Extrait toutes les modifications d'un projet de loi
 */
export function extractModificationsFromProject(
  projectHTML: string
): ModificationBlock[] {
  const cheerio = require('cheerio');
  const $ = cheerio.load(projectHTML);
  const blocks: ModificationBlock[] = [];
  
  $('li.assnatFPFprojetloiartexte').each((index: number, element: any) => {
    const $el = $(element);
    const rawText = $el.text().trim();
    
    // Trouver le lien vers l'article
    const $link = $el.find('a.lien_article_externe');
    const href = $link.attr('href');
    const articleId = href?.match(/LEGIARTI\d+/)?.[0] || '';
    
    // Parser la modification avec le parser reference de tisseuse
    const context = new TextParserContext(rawText);
    const ast = reference(context);
    
    // Extraire le numéro d'article depuis l'AST
    let articleNum = '';
    if (ast && 'reference' in ast) {
      // C'est un TextAstReferenceAndAction
      articleNum = extractArticleNumFromAST(ast.reference);
    } else if (ast) {
      articleNum = extractArticleNumFromAST(ast as TextAstReference);
    }
    
    blocks.push({
      id: `mod-${index}`,
      articleId,
      articleNum,
      rawText,
      ast,
    });
  });
  
  return blocks;
}

/**
 * Extrait le numéro d'article depuis l'AST
 */
function extractArticleNumFromAST(ref: TextAstReference): string {
  if (ref.type === 'article') {
    return ref.num || '';
  }
  
  if (ref.type === 'parent-enfant') {
    // Chercher récursivement
    const parentNum = extractArticleNumFromAST(ref.parent);
    if (parentNum) return parentNum;
    
    return extractArticleNumFromAST(ref.child);
  }
  
  return '';
}
```

**Test** :
```typescript
// Dans modifications.test.ts
import { extractModificationsFromProject } from '../extractors/modifications.js';

test('Extract modifications from Article 2 HTML', () => {
  const html = `
    <li class="assnatFPFprojetloiartexte">
      La seconde phrase du dernier alinéa du II de l'<a class="lien_article_externe" 
      href="https://tricoteuses.fr/legifrance/articles/LEGIARTI000051200465">article 224 du code général des impôts</a> 
      est remplacée par trois alinéas ainsi rédigés : « ... »
    </li>
  `;
  
  const blocks = extractModificationsFromProject(html);
  
  expect(blocks).toHaveLength(1);
  expect(blocks[0].articleId).toBe('LEGIARTI000051200465');
  expect(blocks[0].articleNum).toBe('224');
  expect(blocks[0].ast).toBeDefined();
  expect(blocks[0].ast?.type).toBe('reference_et_action');
});
```

### Étape 2 : Implémenter le navigateur (2h)

**Fichier** : J'ai déjà créé `article-navigator.ts` !

**À faire** :
1. Copier dans `packages/tisseuse/src/lib/navigation/article-navigator.ts`
2. Ajouter les tests
3. Affiner la logique de `findPortion` pour les phrases

**Test prioritaire** :
```typescript
test('Navigate to "dernier alinéa du II"', () => {
  const html = `
    <p>I.- Première section</p>
    <p>II.- Deuxième section</p>
    <p>Premier alinéa.</p>
    <p>Dernier alinéa.</p>
  `;
  
  const navigator = new ArticleNavigator(html);
  
  // AST from tisseuse for "du dernier alinéa du II"
  const reference = {
    type: 'parent-enfant',
    parent: {
      type: 'item',
      num: 'II',
      index: 2,
    },
    child: {
      type: 'alinéa',
      num: 'dernier',
      index: -1,
    },
  };
  
  const result = navigator.locate(reference);
  expect(result).toContain('Dernier alinéa');
});
```

### Étape 3 : Intégration dans Article.svelte (1h)

```svelte
<script lang="ts">
import {
  extractModificationsFromProject,
  ArticleNavigator,
  type ModificationBlock,
} from '@tricoteuses/tisseuse';

// Détecter si on affiche un article modifié par le projet
const projectModifications = $derived.by(() => {
  if (!page.url.searchParams.has('pjl')) return [];
  
  // Récupérer le HTML du projet (depuis votre API/store)
  const projectHTML = getProjectHTML(page.params.pjl);
  if (!projectHTML) return [];
  
  return extractModificationsFromProject(projectHTML);
});

// Filtrer les modifications pour cet article
const thisArticleModifications = $derived(
  projectModifications.filter(mod => 
    mod.articleId === articleInfo.article?.legi_id
  )
);

async function generateModificationDiff(
  mod: ModificationBlock
): Promise<string> {
  if (!mod.ast || !currentBlocTextuel) {
    throw new Error('Missing AST or article HTML');
  }
  
  // 1. Naviguer vers la zone ciblée
  const navigator = new ArticleNavigator(currentBlocTextuel);
  
  const ref = mod.ast.type === 'reference_et_action' 
    ? mod.ast.reference 
    : mod.ast;
  
  const oldHTML = navigator.locate(ref);
  
  // 2. Construire le nouveau HTML selon l'action
  const action = mod.ast.type === 'reference_et_action' 
    ? mod.ast.action 
    : null;
  
  if (!action) {
    throw new Error('No action found');
  }
  
  let newHTML = oldHTML;
  
  switch (action.action) {
    case 'MODIFICATION':
      // Remplacer par les citations
      if (action.originalCitations && action.originalCitations.length > 0) {
        // TODO: Extraire le HTML des citations
        newHTML = '<p>Nouveau contenu TODO</p>';
      }
      break;
    
    case 'SUPPRESSION':
      newHTML = '';
      break;
    
    case 'CREATION':
      // Ajouter après
      newHTML = oldHTML + '<p>Nouveau contenu TODO</p>';
      break;
  }
  
  // 3. Générer le diff (fonction existante !)
  return generateHtmlSplitDiff(oldHTML, newHTML);
}
</script>

<!-- UI -->
{#if thisArticleModifications.length > 0}
  <section class="mt-8 border-t pt-4">
    <h3 class="text-lg font-bold mb-4">
      Modifications apportées par le projet de loi
    </h3>
    
    {#each thisArticleModifications as mod}
      <div class="border rounded p-4 mb-4 bg-blue-50">
        <p class="text-sm text-gray-700 mb-2">
          Modification : {mod.rawText.slice(0, 100)}...
        </p>
        
        <button
          class="lx-link-uppercase"
          onclick={() => showModDiff = showModDiff === mod.id ? null : mod.id}
        >
          {showModDiff === mod.id ? 'Masquer' : 'Voir'} le diff
        </button>
        
        {#if showModDiff === mod.id}
          {#await generateModificationDiff(mod)}
            <p class="mt-2 text-sm">Calcul du diff...</p>
          {:then diffHTML}
            <div class="mt-4 border-t pt-4">
              {@html diffHTML}
            </div>
          {:catch error}
            <p class="mt-2 text-red-600">Erreur : {error.message}</p>
          {/await}
        {/if}
      </div>
    {/each}
  </section>
{/if}
```

## 📋 Checklist pour les prochaines 4 heures

- [ ] **1h** : Créer `extractors/modifications.ts` + tests
- [ ] **1h** : Copier `article-navigator.ts` dans tisseuse + tests basiques
- [ ] **1h** : Affiner `findPortion` pour gérer les phrases
- [ ] **1h** : Intégration dans Article.svelte

## 🎯 Objectif de fin de journée

**Un bouton "Voir les modifications"** dans Article.svelte qui :
1. Détecte les modifications du projet pour cet article
2. Navigue vers la zone modifiée
3. Affiche le diff avec les couleurs rouge/vert

## 💡 Prochaine action IMMÉDIATE

**Créez le fichier `extractors/modifications.ts`** :

```bash
cd tricoteuses-juridique/packages/tisseuse/src/lib/extractors
# Copier le code ci-dessus
vi modifications.ts

# Puis tester
npm test -- extractors/modifications.test.ts
```

Voulez-vous que je vous crée le fichier de test pour l'extracteur ?
