figma.showUI(__html__, { width: 520, height: 400 });

// Get all unique fonts in the document or selection (grouped by family)
function getFonts(nodes) {
  const families = new Map();

  function traverse(node) {
    if (node.type === "TEXT") {
      const textNode = node;
      const len = textNode.characters.length;
      for (let i = 0; i < len; i++) {
        const fontName = textNode.getRangeFontName(i, i + 1);
        if (fontName !== figma.mixed) {
          if (!families.has(fontName.family)) {
            families.set(fontName.family, new Set());
          }
          families.get(fontName.family).add(fontName.style);
        }
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return Array.from(families.entries())
    .map(([family, styles]) => ({ family, styles: Array.from(styles).sort() }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

// Get all available fonts in Figma (grouped by family)
async function getAllFigmaFonts() {
  const availableFonts = await figma.listAvailableFontsAsync();
  const families = new Map();

  for (const font of availableFonts) {
    if (!families.has(font.fontName.family)) {
      families.set(font.fontName.family, []);
    }
    families.get(font.fontName.family).push(font.fontName.style);
  }

  return Array.from(families.entries())
    .map(([family, styles]) => ({ family, styles: styles.sort() }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

// Replace fonts with progress reporting
async function replaceFonts(nodes, fromFont, toFont, onProgress) {
  let replacedCount = 0;

  async function traverse(node) {
    if (node.type === "TEXT") {
      const textNode = node;
      const len = textNode.characters.length;

      const rangesToReplace = [];
      let rangeStart = null;

      for (let i = 0; i <= len; i++) {
        if (i < len) {
          const fontName = textNode.getRangeFontName(i, i + 1);
          if (
            fontName !== figma.mixed &&
            fontName.family === fromFont.family &&
            fontName.style === fromFont.style
          ) {
            if (rangeStart === null) rangeStart = i;
          } else {
            if (rangeStart !== null) {
              rangesToReplace.push({ start: rangeStart, end: i });
              rangeStart = null;
            }
          }
        } else if (rangeStart !== null) {
          rangesToReplace.push({ start: rangeStart, end: i });
        }
      }

      for (const range of rangesToReplace) {
        await figma.loadFontAsync(toFont);
        textNode.setRangeFontName(range.start, range.end, toFont);
        replacedCount++;
        if (onProgress) onProgress(replacedCount);
      }
    }

    if ("children" in node) {
      for (const child of node.children) {
        await traverse(child);
      }
    }
  }

  for (const node of nodes) {
    await traverse(node);
  }

  return replacedCount;
}

// Get nodes to process
function getNodes() {
  return figma.currentPage.selection.length > 0
    ? figma.currentPage.selection
    : figma.currentPage.children;
}

// Initial load
async function init() {
  const selectionFonts = getFonts(getNodes());
  const allFonts = await getAllFigmaFonts();
  figma.ui.postMessage({
    type: "init",
    selectionFonts,
    allFonts,
    hasSelection: figma.currentPage.selection.length > 0,
  });
}

init();

// Listen for selection changes
figma.on("selectionchange", () => {
  const selectionFonts = getFonts(getNodes());
  figma.ui.postMessage({
    type: "selection-update",
    selectionFonts,
    hasSelection: figma.currentPage.selection.length > 0,
  });
});

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === "replace-batch") {
    const { fromList, to } = msg;
    const toFont = { family: to.family, style: to.style };
    
    let totalReplaced = 0;
    let currentFont = 0;
    const totalFonts = fromList.length;
    
    try {
      await figma.loadFontAsync(toFont);
      
      for (const from of fromList) {
        currentFont++;
        const fromFont = { family: from.family, style: from.style };
        
        figma.ui.postMessage({
          type: "progress",
          message: `Replacing ${currentFont}/${totalFonts}: ${from.family} ${from.style}...`,
          count: totalReplaced
        });
        
        const count = await replaceFonts(getNodes(), fromFont, toFont, (c) => {
          figma.ui.postMessage({
            type: "progress",
            message: `Replacing ${currentFont}/${totalFonts}: ${from.family} ${from.style}...`,
            count: totalReplaced + c
          });
        });
        
        totalReplaced += count;
      }
      
      figma.ui.postMessage({
        type: "success",
        message: `Replaced ${totalReplaced} instance(s)`,
      });

      const selectionFonts = getFonts(getNodes());
      figma.ui.postMessage({
        type: "selection-update",
        selectionFonts,
        hasSelection: figma.currentPage.selection.length > 0,
      });
    } catch (err) {
      figma.ui.postMessage({
        type: "error",
        message: `Could not load font: ${to.family} ${to.style}`,
      });
    }
  }

  if (msg.type === "cancel") {
    figma.closePlugin();
  }
  
  if (msg.type === "open-link") {
    figma.openExternal(msg.url);
  }
};
