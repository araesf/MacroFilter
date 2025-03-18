// Global variables
let menuItemsData = [];
let processingItems = false;
let targetMacro = 'protein';

// National average nutrition data for common food categories
const NATIONAL_AVERAGES = {
  'Fast Food': {
    protein: 25,
    calories: 450,
    carbs: 45,
    fat: 20
  },
  'Mexican': {
    protein: 28,
    calories: 550,
    carbs: 60,
    fat: 25
  },
  'Italian': {
    protein: 22,
    calories: 600,
    carbs: 70,
    fat: 30
  },
  'Asian': {
    protein: 26,
    calories: 500,
    carbs: 55,
    fat: 22
  },
  'American': {
    protein: 30,
    calories: 650,
    carbs: 50,
    fat: 35
  },
  'default': {
    protein: 25,
    calories: 500,
    carbs: 50,
    fat: 25
  }
};

// Function to scrape menu items from DoorDash
async function scrapeDoorDashMenuItems() {
  // Check if we're on DoorDash
  if (!window.location.href.includes('doordash.com')) return;
  // Prevent multiple simultaneous scans
  if (processingItems) return;
  
  processingItems = true;
  console.log("Scanning DoorDash menu items...");
  
  // Get restaurant name and description
  let restaurantName = '';
  let restaurantDescription = '';
  try {
    const titleElement = document.querySelector('h1.Text-sc-1nm69d8-0');
    const descElement = document.querySelector('div[class*="Text-sc"]');
    if (titleElement) {
      restaurantName = titleElement.textContent.trim();
    }
    if (descElement) {
      restaurantDescription = descElement.textContent.trim();
    }
  } catch (e) {
    console.error("Error finding restaurant info:", e);
  }
  
  // Find all menu items
  let menuItems = [];
  
  // First try to find items by looking for inline children elements
  const inlineChildrenContainers = document.querySelectorAll('div[class*="InlineChildren_StyledInlineChildren"]');
  inlineChildrenContainers.forEach(container => {
    // Look for h1 elements inside these containers
    const itemHeaders = container.querySelectorAll('h1[class*="Text-sc-1nm69d8"]');
    itemHeaders.forEach(header => {
      if (header.closest('div[class*="Stack_StyledStack"]')) {
        menuItems.push(header.closest('div[class*="Stack_StyledStack"]'));
      }
    });
  });
  
  // If no items found with the above approach, try another approach
  if (menuItems.length === 0) {
    // Look for common item containers
    menuItems = document.querySelectorAll('div[class*="sc-"][role="button"]');
  }
  
  console.log(`Found ${menuItems.length} potential menu items`);
  menuItemsData = [];
  
  // Process each menu item
  for (let i = 0; i < menuItems.length; i++) {
    const item = menuItems[i];
    try {
      // Extract item name
      let name = '';
      const nameElement = item.querySelector('h1[class*="Text-sc"], span[class*="Text-sc"]');
      if (nameElement) {
        name = nameElement.textContent.trim();
      }
      
      if (!name) continue; // Skip items without names
      
      // Extract description and price
      let description = '';
      let price = '';
      
      // Try to find description - it's usually in a Text element following the name
      const descElements = item.querySelectorAll('span[class*="Text-sc"], div[class*="Text-sc"]');
      if (descElements.length > 1) {
        // The second text element is likely the description
        description = descElements[1].textContent.trim();
      }
      
      // Look for price - usually contained in a specific element
      const priceElement = item.querySelector('span[class*="-price"]') || 
                          item.querySelector('div[class*="-price"]') ||
                          item.querySelector('span:last-child');
      if (priceElement) {
        price = priceElement.textContent.trim();
      }
      
      // Try to get image URL
      let imageUrl = '';
      const imgElement = item.querySelector('img') || item.querySelector('div[class*="ImageContainer"] img');
      if (imgElement && imgElement.src) {
        imageUrl = imgElement.src;
      }
      
      // Get nutrition data
      let nutritionData = await getNutritionalData(name, restaurantName, description);
      
      // Calculate protein efficiency score
      const proteinEfficiency = calculateProteinEfficiency({
        name,
        restaurantName,
        description,
        ...nutritionData
      });
      
      // Add to our data
      const menuItem = {
        name,
        restaurantName,
        description,
        price,
        imageUrl,
        ...nutritionData,
        proteinEfficiency
      };
      
      menuItemsData.push(menuItem);
      
      // Update popup every few items
      if (i % 3 === 0 || i === menuItems.length - 1) {
        chrome.runtime.sendMessage({
          action: "menuItemsScanned",
          data: menuItemsData
        });
      }
    } catch (e) {
      console.error("Error parsing menu item:", e);
    }
  }
  
  console.log(`Successfully processed ${menuItemsData.length} menu items`);
  processingItems = false;
  
  // Final update to popup
  chrome.runtime.sendMessage({
    action: "menuItemsScanned",
    data: menuItemsData
  });
}

// Function to search for nutrition data using Nutritionix API
async function searchNutritionixAPI(foodItem, restaurantName) {
  const appId = '7fd3164b';
  const appKey = 'fd3863c8378ff2dd6263e8c5b3d9d91f';
  
  // Format the search query
  let query = foodItem;
  if (restaurantName && restaurantName !== 'DoorDash Restaurant') {
    query = `${restaurantName} ${foodItem}`;
  }
  
  try {
    const response = await fetch('https://trackapi.nutritionix.com/v2/natural/nutrients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': appId,
        'x-app-key': appKey
      },
      body: JSON.stringify({
        query: query
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.foods && data.foods.length > 0) {
      const food = data.foods[0];
      
      return {
        protein: Math.round(food.nf_protein),
        carbs: Math.round(food.nf_total_carbohydrate),
        fat: Math.round(food.nf_total_fat),
        calories: Math.round(food.nf_calories)
      };
    } else {
      throw new Error('No nutrition data found');
    }
  } catch (error) {
    console.error('Nutritionix API error:', error);
    throw error;
  }
}

// Function to get nutritional data with multiple approaches
async function getNutritionalData(itemName, restaurantName, description) {
  try {
    // First try the Nutritionix API
    return await searchNutritionixAPI(itemName, restaurantName);
  } catch (error) {
    console.log("Nutritionix API failed, trying fallback:", error);
    
    // For specific restaurant chains, use custom logic
    if (restaurantName.toLowerCase().includes('taco bell')) {
      return getTacoBellNutrition(itemName, description);
    }
    
    // Last resort, use basic estimation
    return estimateNutrition(itemName, description);
  }
}

// Special handler for Taco Bell items (since we can see Taco Bell in image 2)
function getTacoBellNutrition(itemName, description) {
  const lowerName = itemName.toLowerCase();
  const lowerDesc = description.toLowerCase();
  
  let protein = 0, carbs = 0, fat = 0;
  
  // Base values for common Taco Bell items
  if (lowerName.includes('chalupa') || lowerDesc.includes('chalupa')) {
    protein += 14;
    carbs += 25;
    fat += 16;
  }
  
  if (lowerName.includes('taco') || lowerDesc.includes('taco')) {
    protein += 8;
    carbs += 12;
    fat += 7;
  }
  
  if (lowerName.includes('supreme') || lowerDesc.includes('supreme')) {
    protein += 2;
    carbs += 3;
    fat += 2;
  }
  
  if (lowerName.includes('chicken') || lowerDesc.includes('chicken')) {
    protein += 13;
    carbs += 0;
    fat += 3;
  }
  
  if (lowerName.includes('beef') || lowerDesc.includes('beef')) {
    protein += 8;
    carbs += 1;
    fat += 6;
  }
  
  if (lowerName.includes('combo') || lowerDesc.includes('combo')) {
    protein += 5;
    carbs += 30;  // For the sides and drink
    fat += 5;
  }
  
  // Calculate calories
  const calories = protein * 4 + carbs * 4 + fat * 9;
  
  return { protein, carbs, fat, calories };
}

// Basic function to estimate nutrition when API fails
function estimateNutrition(name, description) {
  const lowerName = name.toLowerCase();
  const lowerDesc = description.toLowerCase();
  
  let protein = 0, carbs = 0, fat = 0;
  
  // Protein-rich foods
  if (lowerName.includes('chicken') || lowerDesc.includes('chicken')) protein += 25;
  if (lowerName.includes('beef') || lowerDesc.includes('beef')) protein += 22;
  if (lowerName.includes('fish') || lowerDesc.includes('fish')) protein += 20;
  if (lowerName.includes('pork') || lowerDesc.includes('pork')) protein += 22;
  if (lowerName.includes('tofu') || lowerDesc.includes('tofu')) protein += 10;
  if (lowerName.includes('egg') || lowerDesc.includes('egg')) protein += 12;
  if (lowerName.includes('protein') || lowerDesc.includes('protein')) protein += 20;
  
  // Carb-rich foods
  if (lowerName.includes('rice') || lowerDesc.includes('rice')) carbs += 45;
  if (lowerName.includes('pasta') || lowerDesc.includes('pasta')) carbs += 50;
  if (lowerName.includes('bread') || lowerDesc.includes('bread')) carbs += 15;
  if (lowerName.includes('potato') || lowerDesc.includes('potato')) carbs += 30;
  if (lowerName.includes('noodle') || lowerDesc.includes('noodle')) carbs += 40;
  if (lowerName.includes('pizza') || lowerDesc.includes('pizza')) carbs += 35;
  if (lowerName.includes('bun') || lowerDesc.includes('bun')) carbs += 20;
  if (lowerName.includes('tortilla') || lowerDesc.includes('tortilla')) carbs += 25;
  if (lowerName.includes('wrap') || lowerDesc.includes('wrap')) carbs += 20;
  
  // Fat-rich foods
  if (lowerName.includes('cheese') || lowerDesc.includes('cheese')) fat += 10;
  if (lowerName.includes('bacon') || lowerDesc.includes('bacon')) fat += 12;
  if (lowerName.includes('avocado') || lowerDesc.includes('avocado')) fat += 15;
  if (lowerName.includes('butter') || lowerDesc.includes('butter')) fat += 10;
  if (lowerName.includes('oil') || lowerDesc.includes('oil')) fat += 14;
  if (lowerName.includes('fried') || lowerDesc.includes('fried')) fat += 15;
  
  // Calculate calories
  const calories = protein * 4 + carbs * 4 + fat * 9;
  
  return { protein, carbs, fat, calories };
}

// Parse any calorie information if available in the description
function extractCalories(description) {
  if (!description) return null;
  
  // Look for patterns like "(800 cal)" or "(800-900 cal)" or "(800 calories)"
  const calorieMatch = description.match(/\((\d+(?:-\d+)?)\s*cal(?:ories)?\)/i);
  if (calorieMatch) {
    const calString = calorieMatch[1];
    if (calString.includes('-')) {
      // If it's a range, take the average
      const [min, max] = calString.split('-').map(Number);
      return Math.round((min + max) / 2);
    } else {
      return parseInt(calString, 10);
    }
  }
  
  return null;
}

// Function to determine restaurant category
function determineRestaurantCategory(restaurantName, description) {
  const categories = {
    'Fast Food': ['mcdonalds', 'burger king', 'wendys', 'taco bell', 'subway', 'chick-fil-a'],
    'Mexican': ['mexican', 'taco', 'burrito', 'chipotle', 'qdoba'],
    'Italian': ['pizza', 'pasta', 'italian', 'olive garden'],
    'Asian': ['chinese', 'japanese', 'thai', 'vietnamese', 'sushi', 'asian'],
    'American': ['american', 'diner', 'grill', 'steakhouse']
  };

  const searchText = (restaurantName + ' ' + description).toLowerCase();
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => searchText.includes(keyword))) {
      return category;
    }
  }
  
  return 'default';
}

// Function to calculate protein efficiency score
function calculateProteinEfficiency(item) {
  const category = determineRestaurantCategory(item.restaurantName, item.description);
  const averages = NATIONAL_AVERAGES[category] || NATIONAL_AVERAGES.default;
  
  // Calculate protein-to-calorie ratio
  const proteinRatio = item.protein / item.calories;
  const avgProteinRatio = averages.protein / averages.calories;
  
  // Calculate how much better this item is than the average
  const efficiencyScore = (proteinRatio / avgProteinRatio) * 100;
  
  return efficiencyScore;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "scanMenuItems") {
    scrapeDoorDashMenuItems();
  }
  
  if (request.action === "getMenuItems") {
    sendResponse({
      menuItems: menuItemsData
    });
    return true; // Required for async sendResponse
  }
});

// Initialize when the page is fully loaded
window.addEventListener('load', function() {
  console.log("Macro Diet Filter extension loaded on DoorDash");
  
  // Set up a mutation observer to detect when the page content changes
  const observer = new MutationObserver(function(mutations) {
    // If there are significant DOM changes, we might need to re-scan
    if (mutations.some(mutation => mutation.addedNodes.length > 0)) {
      // Debounce to avoid too many scans
      clearTimeout(window.rescanTimeout);
      window.rescanTimeout = setTimeout(() => {
        // Only re-scan if we're on a restaurant page
        if (window.location.href.includes('/store/') || 
            window.location.href.includes('/restaurant/')) {
          console.log("DoorDash page updated, rescanning...");
          scrapeDoorDashMenuItems();
        }
      }, 2000);
    }
  });
  
  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Initial scan if we're on a restaurant page
  if (window.location.href.includes('/store/') || 
      window.location.href.includes('/restaurant/')) {
    // Delay to let page fully render
    setTimeout(scrapeDoorDashMenuItems, 3000);
  }
});