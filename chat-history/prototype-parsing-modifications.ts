/**
 * PROTOTYPE : Parser les modifications législatives avec tisseuse
 * 
 * Ce fichier montre comment utiliser les parsers existants de @tricoteuses/tisseuse
 * pour parser les modifications d'un projet de loi et générer des diffs.
 */

import {
  action,
  reference,
  TextParserContext,
  type TextAstAction,
  type TextAstReference,
  type TextAstReferenceAndAction,
  type TextAstArticle,
  type TextAstDivision,
  type TextAstPortion,
} from '@tricoteuses/tisseuse';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Représente une modification extraite d'un projet de loi
 */
interface ModificationBlock {
  id: string;
  articleId: string;          // ID de l'article en vigueur (ex: LEGIARTI000051200465)
  articleTitle: string;        // Titre lisible (ex: "article 224 du CGI")
  rawText: string;             // Texte brut de la modification
  ast?: ParsedModification;    // AST parsé
}

/**
 * Structure parsée d'une modification
 */
interface ParsedModification {
  action: TextAstAction;       // Type d'action (MODIFICATION, CREATION, SUPPRESSION...)
  reference?: TextAstReference; // Référence à la zone ciblée
  targetPath?: NavigationPath;  // Chemin de navigation calculé
}

/**
 * Chemin de navigation dans un article
 */
interface NavigationPath {
  steps: NavigationStep[];
}

interface NavigationStep {
  type: 'article' | 'division' | 'portion';
  identifier?: string | number;
  ordinal?: 'first' | 'last' | 'second' | number;
  relative?: number;
}

// ============================================================================
// PARSING DES MODIFICATIONS
// ============================================================================

/**
 * Parse une modification législative en utilisant les parsers de tisseuse
 * 
 * Exemples supportés :
 * - "La seconde phrase du dernier alinéa du II de l'article 224 est remplacée par..."
 * - "Après le III, il est inséré un III bis ainsi rédigé : ..."
 * - "Le A du IV est remplacé par..."
 */
export function parseModification(text: string): ParsedModification | null {
  const context = new TextParserContext(text);
  
  // Essayer de parser une référence + action
  // Ex: "La seconde phrase du dernier alinéa du II est remplacée"
  let result = reference(context);
  
  if (!result) {
    // Peut-être juste une action sans référence explicite ?
    result = action(context);
  }
  
  if (!result) {
    console.warn('Failed to parse modification:', text.slice(0, 100));
    return null;
  }
  
  // Extraire l'action et la référence
  let parsedAction: TextAstAction;
  let parsedReference: TextAstReference | undefined;
  
  if (result.type === 'reference_et_action') {
    const refAndAction = result as TextAstReferenceAndAction;
    parsedAction = refAndAction.action;
    parsedReference = refAndAction.reference;
  } else if ('action' in result) {
    parsedAction = result as TextAstAction;
  } else {
    console.warn('Unexpected parse result type:', result);
    return null;
  }
  
  return {
    action: parsedAction,
    reference: parsedReference,
    targetPath: parsedReference ? convertAstToNavigationPath(parsedReference) : undefined,
  };
}

/**
 * Convertit un AST de référence en chemin de navigation
 * 
 * Ex: TextAstReference pour "seconde phrase du dernier alinéa du II"
 *  → NavigationPath: [
 *      { type: 'division', identifier: 'II' },
 *      { type: 'portion', ordinal: 'last' },  // dernier alinéa
 *      { type: 'portion', ordinal: 'second' }  // seconde phrase
 *    ]
 */
function convertAstToNavigationPath(reference: TextAstReference): NavigationPath {
  const steps: NavigationStep[] = [];
  
  // Parcourir l'AST de manière récursive
  walkReference(reference, steps);
  
  return { steps };
}

function walkReference(ref: TextAstReference, steps: NavigationStep[]): void {
  switch (ref.type) {
    case 'article':
      const article = ref as TextAstArticle;
      steps.push({
        type: 'article',
        identifier: article.num,
        relative: article.relative,
      });
      break;
    
    case 'partie':
    case 'livre':
    case 'titre':
    case 'sous-titre':
    case 'chapitre':
    case 'section':
    case 'sous-section':
    case 'paragraphe':
    case 'sous-paragraphe':
    case 'sous-sous-paragraphe':
      const division = ref as TextAstDivision;
      steps.push({
        type: 'division',
        identifier: division.num,
        relative: division.relative,
      });
      break;
    
    case 'alinéa':
    case 'phrase':
    case 'item':
      const portion = ref as TextAstPortion;
      steps.push({
        type: 'portion',
        identifier: portion.num,
        relative: portion.relative,
      });
      break;
    
    case 'parent-enfant':
      // Ex: "du II" → parent = II, enfant = portion actuelle
      walkReference(ref.parent, steps);
      walkReference(ref.child, steps);
      break;
    
    case 'enumeration':
    case 'bounded-interval':
    case 'counted-interval':
      // Pour l'instant, on prend juste la première référence
      walkReference(ref.left || ref.first, steps);
      break;
    
    case 'reference_et_action':
      walkReference(ref.reference, steps);
      break;
    
    default:
      console.warn('Unhandled reference type:', ref.type);
  }
}

// ============================================================================
// NAVIGATION DANS L'ARTICLE HTML
// ============================================================================

/**
 * Classe pour naviguer dans un article HTML selon un chemin
 */
export class ArticleNavigator {
  private dom: Document;
  private article: HTMLElement;
  
  constructor(articleHTML: string) {
    // Note: En environnement Node, utiliser JSDOM ou similar-dom
    // En environnement browser, DOMParser est disponible
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      this.dom = parser.parseFromString(articleHTML, 'text/html');
    } else {
      // Pour Node.js, on devrait utiliser jsdom
      throw new Error('DOMParser not available - use jsdom in Node environment');
    }
    
    this.article = this.dom.body;
  }
  
  /**
   * Localise un élément dans l'article selon le chemin de navigation
   */
  locate(path: NavigationPath): HTMLElement {
    let current: HTMLElement = this.article;
    
    for (const step of path.steps) {
      current = this.navigateStep(current, step);
    }
    
    return current;
  }
  
  private navigateStep(scope: HTMLElement, step: NavigationStep): HTMLElement {
    switch (step.type) {
      case 'division':
        return this.findDivision(scope, step);
      
      case 'portion':
        return this.findPortion(scope, step);
      
      case 'article':
        // L'article est déjà le scope global
        return scope;
      
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }
  
  /**
   * Trouve une division (I, II, A, B, 1°...)
   */
  private findDivision(scope: HTMLElement, step: NavigationStep): HTMLElement {
    const paragraphs = Array.from(scope.querySelectorAll('p'));
    
    // Patterns à chercher
    const patterns = this.getDivisionPatterns(step.identifier);
    
    for (const p of paragraphs) {
      const text = p.textContent?.trim() || '';
      
      if (patterns.some(pattern => text.startsWith(pattern))) {
        return p;
      }
    }
    
    throw new Error(`Division ${step.identifier} not found`);
  }
  
  /**
   * Trouve une portion (alinéa, phrase...)
   */
  private findPortion(scope: HTMLElement, step: NavigationStep): HTMLElement {
    const paragraphs = Array.from(scope.querySelectorAll('p'));
    
    // Gérer les ordinaux
    let targetIndex: number;
    
    if (step.relative !== undefined) {
      // Relative: +1, -1, etc.
      targetIndex = step.relative;
    } else if (step.ordinal === 'last') {
      targetIndex = paragraphs.length - 1;
    } else if (step.ordinal === 'first') {
      targetIndex = 0;
    } else if (step.ordinal === 'second') {
      targetIndex = 1;
    } else if (typeof step.ordinal === 'number') {
      targetIndex = step.ordinal - 1; // 1-indexed
    } else {
      throw new Error('Invalid portion ordinal');
    }
    
    const p = paragraphs[targetIndex];
    if (!p) {
      throw new Error(`Portion at index ${targetIndex} not found`);
    }
    
    return p;
  }
  
  private getDivisionPatterns(identifier: string | number | undefined): string[] {
    if (!identifier) return [];
    
    const id = String(identifier);
    
    return [
      `${id}.-`,
      `${id}. -`,
      `${id} -`,
      `${id}.`,
      `${id}°`,
    ];
  }
  
  /**
   * Extrait le HTML d'un élément
   */
  extractHTML(element: HTMLElement): string {
    return element.outerHTML;
  }
  
  /**
   * Extrait le texte brut d'un élément
   */
  extractText(element: HTMLElement): string {
    return element.textContent || '';
  }
}

// ============================================================================
// EXTRACTION DES MODIFICATIONS D'UN PROJET DE LOI
// ============================================================================

/**
 * Extrait toutes les modifications d'un article de projet de loi
 */
export function extractModificationsFromProject(projectHTML: string): ModificationBlock[] {
  const parser = new DOMParser();
  const dom = parser.parseFromString(projectHTML, 'text/html');
  const blocks: ModificationBlock[] = [];
  
  // Trouver tous les <li> avec des modifications
  const items = dom.querySelectorAll('li.assnatFPFprojetloiartexte');
  
  items.forEach((item, index) => {
    // Trouver le lien vers l'article
    const link = item.querySelector('a.lien_article_externe');
    
    if (link) {
      const href = link.getAttribute('href');
      const articleId = extractArticleId(href);
      const rawText = item.textContent || '';
      
      // Parser la modification
      const ast = parseModification(rawText);
      
      blocks.push({
        id: `mod-${index}`,
        articleId,
        articleTitle: link.textContent || '',
        rawText,
        ast: ast || undefined,
      });
    }
  });
  
  return blocks;
}

function extractArticleId(href: string | null): string {
  if (!href) return '';
  
  // Ex: "https://tricoteuses.fr/legifrance/articles/LEGIARTI000051200465"
  const match = href.match(/LEGIARTI\d+/);
  return match ? match[0] : '';
}

// ============================================================================
// GÉNÉRATION DE DIFF
// ============================================================================

/**
 * Applique une modification à un article et retourne le HTML avec diff
 * 
 * Cette fonction devrait :
 * 1. Naviguer dans l'article pour trouver la zone ciblée
 * 2. Extraire le texte/HTML actuel
 * 3. Construire le nouveau texte selon le type d'action
 * 4. Appeler generateHtmlSplitDiff() d'Article.svelte
 */
export async function applyModificationAndGenerateDiff(
  modification: ModificationBlock,
  articleHTML: string,
  generateHtmlSplitDiff: (oldHTML: string, newHTML: string) => string,
): Promise<string> {
  
  if (!modification.ast) {
    throw new Error('Modification has no AST');
  }
  
  if (!modification.ast.targetPath) {
    throw new Error('Modification has no target path');
  }
  
  // 1. Naviguer dans l'article
  const navigator = new ArticleNavigator(articleHTML);
  const targetElement = navigator.locate(modification.ast.targetPath);
  
  // 2. Extraire le HTML actuel
  const oldHTML = navigator.extractHTML(targetElement);
  
  // 3. Construire le nouveau HTML selon le type d'action
  let newHTML: string;
  
  switch (modification.ast.action.action) {
    case 'MODIFICATION':
      // Remplacer le contenu par les citations
      newHTML = buildNewHTMLFromCitations(
        oldHTML,
        modification.ast.action.originalCitations
      );
      break;
    
    case 'CREATION':
      // Insérer le nouveau contenu
      newHTML = oldHTML + buildNewHTMLFromCitations('', modification.ast.action.originalCitations);
      break;
    
    case 'SUPPRESSION':
      // Supprimer
      newHTML = '';
      break;
    
    case 'CREATION_OU_MODIFICATION':
      // Comme MODIFICATION
      newHTML = buildNewHTMLFromCitations(
        oldHTML,
        modification.ast.action.originalCitations
      );
      break;
    
    default:
      throw new Error(`Unknown action: ${modification.ast.action.action}`);
  }
  
  // 4. Générer le diff avec la fonction existante
  return generateHtmlSplitDiff(oldHTML, newHTML);
}

function buildNewHTMLFromCitations(
  oldHTML: string,
  citations?: any[]
): string {
  if (!citations || citations.length === 0) {
    return oldHTML;
  }
  
  // Extraire le texte des citations
  // Les citations sont dans l'AST sous forme de TextAstCitation
  // TODO: Utiliser convertCitationToText() de tisseuse
  
  // Pour l'instant, retourner une version simplifiée
  return '<p>Nouveau contenu TODO</p>';
}

// ============================================================================
// EXEMPLE D'UTILISATION
// ============================================================================

export function exemple() {
  const texteModification = `La seconde phrase du dernier alinéa du II de l'article 224 du code général des impôts est remplacée par trois alinéas ainsi rédigés : « En cas de modification... »`;
  
  const parsed = parseModification(texteModification);
  
  console.log('Parsed modification:', JSON.stringify(parsed, null, 2));
  
  // Exemple de navigation
  if (parsed?.targetPath) {
    console.log('Navigation path:', parsed.targetPath);
    
    // Dans Article.svelte, on ferait :
    // const navigator = new ArticleNavigator(articleHTML);
    // const targetElement = navigator.locate(parsed.targetPath);
    // const oldHTML = navigator.extractHTML(targetElement);
    // const diffHTML = generateHtmlSplitDiff(oldHTML, newHTML);
  }
}
