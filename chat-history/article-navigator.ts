/**
 * Navigateur d'articles HTML selon les références AST de tisseuse
 * 
 * Fichier à placer dans : packages/tisseuse/src/lib/navigation/article-navigator.ts
 */

import type {
  TextAstReference,
  TextAstReferenceAndAction,
  TextAstParentChild,
  TextAstArticle,
  TextAstDivision,
  TextAstPortion,
} from '../text_parsers/ast.js';

export class ArticleNavigator {
  private cheerio: any;
  private $: any;
  
  constructor(articleHTML: string) {
    // Note: cheerio est déjà dans devDependencies de tisseuse
    this.cheerio = require('cheerio');
    this.$ = this.cheerio.load(articleHTML);
  }
  
  /**
   * Localise un élément dans l'article selon une référence AST
   * 
   * @param reference - AST de référence (peut inclure action)
   * @returns HTML de l'élément trouvé
   */
  locate(reference: TextAstReference | TextAstReferenceAndAction): string {
    // Si c'est une référence + action, extraire juste la référence
    const ref = reference.type === 'reference_et_action' 
      ? reference.reference 
      : reference;
    
    // Convertir l'AST en chemin de navigation
    const path = this.extractNavigationPath(ref);
    
    console.log('Navigation path:', path);
    
    // Naviguer dans le DOM
    return this.navigatePath(path);
  }
  
  /**
   * Extrait le chemin de navigation depuis l'AST
   * 
   * L'AST est une structure parent-enfant imbriquée.
   * On doit "aplatir" cette structure en un tableau linéaire.
   * 
   * Ex: parent(texte) -> child(parent(article) -> child(parent(item II) -> child(...)))
   *  → [texte, article, item II, alinéa, phrase]
   */
  private extractNavigationPath(ref: TextAstReference): NavigationStep[] {
    const path: NavigationStep[] = [];
    
    // Parcourir récursivement les parent-enfant
    this.walkReference(ref, path);
    
    // Inverser car on veut aller du général (texte) au spécifique (phrase)
    // Mais en fait l'AST est déjà dans cet ordre !
    return path;
  }
  
  /**
   * Parcours récursif de l'AST parent-enfant
   */
  private walkReference(ref: TextAstReference, path: NavigationStep[]): void {
    if (ref.type === 'parent-enfant') {
      const pc = ref as TextAstParentChild;
      
      // D'abord le parent (plus général)
      this.walkReference(pc.parent, path);
      
      // Puis l'enfant (plus spécifique)
      this.walkReference(pc.child, path);
      
    } else {
      // C'est une référence atomique (article, division, portion...)
      path.push(this.referenceToStep(ref));
    }
  }
  
  /**
   * Convertit une référence atomique en étape de navigation
   */
  private referenceToStep(ref: TextAstReference): NavigationStep {
    switch (ref.type) {
      case 'texte':
        return {
          type: 'texte',
          cid: (ref as any).cid,
        };
      
      case 'article':
        return {
          type: 'article',
          num: (ref as TextAstArticle).num,
        };
      
      case 'item':
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
        return {
          type: 'division',
          divisionType: ref.type,
          num: (ref as any).num,
          index: (ref as any).index,
        };
      
      case 'alinéa':
      case 'phrase':
        return {
          type: 'portion',
          portionType: ref.type,
          index: (ref as any).index,
          num: (ref as any).num,
        };
      
      default:
        throw new Error(`Unsupported reference type: ${ref.type}`);
    }
  }
  
  /**
   * Navigate dans le DOM selon le chemin
   */
  private navigatePath(path: NavigationStep[]): string {
    let scope = this.$('body'); // Scope initial = tout l'article
    
    for (const step of path) {
      switch (step.type) {
        case 'texte':
          // Le texte est le scope global, on ne fait rien
          break;
        
        case 'article':
          // L'article est déjà le scope global dans notre cas
          break;
        
        case 'division':
          scope = this.findDivision(scope, step);
          break;
        
        case 'portion':
          scope = this.findPortion(scope, step);
          break;
      }
    }
    
    return scope.html() || '';
  }
  
  /**
   * Trouve une division (I, II, A, B, 1°...)
   */
  private findDivision(scope: any, step: NavigationStep): any {
    const { num, index } = step;
    
    // Chercher tous les <p> dans le scope
    const paragraphs = scope.find('p').toArray();
    
    // Si on a un num (ex: "II", "A"), chercher par pattern
    if (num) {
      const patterns = this.getDivisionPatterns(num);
      
      for (const p of paragraphs) {
        const text = this.$(p).text().trim();
        
        if (patterns.some(pattern => text.startsWith(pattern))) {
          return this.$(p);
        }
      }
    }
    
    // Si on a un index, utiliser l'indexation
    if (index !== undefined && index >= 0) {
      return this.$(paragraphs[index]);
    }
    
    throw new Error(`Division not found: ${JSON.stringify(step)}`);
  }
  
  /**
   * Trouve une portion (alinéa, phrase)
   */
  private findPortion(scope: any, step: NavigationStep): any {
    const { portionType, index, num } = step;
    
    if (portionType === 'alinéa') {
      // Les alinéas sont des <p>
      const paragraphs = scope.find('p').toArray();
      
      if (num === 'dernier' || index === -1) {
        // Dernier alinéa
        return this.$(paragraphs[paragraphs.length - 1]);
      }
      
      if (index !== undefined && index >= 0) {
        return this.$(paragraphs[index]);
      }
    }
    
    if (portionType === 'phrase') {
      // Les phrases sont à l'intérieur d'un <p>
      // Il faut splitter le texte par phrases
      
      const text = scope.text();
      const sentences = this.splitSentences(text);
      
      if (index !== undefined && index >= 0) {
        // index est 0-based ou 1-based ?
        // D'après les tests : index: 2 pour "seconde"
        // Donc probablement 1-based : seconde = index 2
        const sentenceIndex = index === 0 ? 0 : index - 1;
        const sentence = sentences[sentenceIndex];
        
        if (!sentence) {
          throw new Error(`Sentence at index ${index} not found`);
        }
        
        // Pour l'instant, retourner le scope entier
        // Dans une vraie implémentation, il faudrait marquer
        // juste la phrase spécifique dans le HTML
        return scope;
      }
    }
    
    throw new Error(`Portion not found: ${JSON.stringify(step)}`);
  }
  
  /**
   * Patterns possibles pour une division
   */
  private getDivisionPatterns(num: string): string[] {
    return [
      `${num}.-`,
      `${num}. -`,
      `${num} -`,
      `${num}.`,
      `${num}°`,
      `${num})`,
    ];
  }
  
  /**
   * Split le texte en phrases
   */
  private splitSentences(text: string): string[] {
    // Simplification : split sur . ! ? suivi d'espace
    return text
      .split(/[.!?]\s+/)
      .filter(s => s.trim().length > 0);
  }
}

/**
 * Étape de navigation dans un article
 */
interface NavigationStep {
  type: 'texte' | 'article' | 'division' | 'portion';
  
  // Pour texte
  cid?: string;
  
  // Pour article
  num?: string;
  
  // Pour division
  divisionType?: string;
  
  // Pour portion
  portionType?: string;
  
  // Index dans le DOM
  index?: number;
}

/**
 * Exemple d'utilisation
 */
export function exemple() {
  const articleHTML = `
    <p>I.- Première section</p>
    <p>Texte de la première section.</p>
    <p>II.- Deuxième section</p>
    <p>Premier alinéa. Première phrase. Seconde phrase.</p>
    <p>Dernier alinéa.</p>
  `;
  
  const navigator = new ArticleNavigator(articleHTML);
  
  // Exemple de référence AST (simplifié)
  const reference: any = {
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
  
  try {
    const html = navigator.locate(reference);
    console.log('Found HTML:', html);
  } catch (error) {
    console.error('Navigation error:', error);
  }
}
