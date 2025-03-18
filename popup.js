document.addEventListener('DOMContentLoaded', function() {
  // Scan menu button
  document.getElementById('scan-now').addEventListener('click', function() {
    const container = document.getElementById('menu-items-container');
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Scanning menu items...</p></div>';
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "scanMenuItems"
      });
    });
  });
  
  // Listen for updates from content script
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "menuItemsScanned") {
      renderMenuItems(request.data);
    }
  });
  
  function renderMenuItems(items) {
    const container = document.getElementById('menu-items-container');
    
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="no-results">No menu items found. Make sure you\'re on a DoorDash restaurant page.</div>';
      return;
    }
    
    // Sort items based on protein efficiency
    let sortedItems = [...items].sort((a, b) => b.proteinEfficiency - a.proteinEfficiency);
    
    // Create HTML for menu items
    const itemsHTML = sortedItems.map(item => `
      <div class="menu-item">
        <div class="menu-item-image" style="background-image: url('${item.imageUrl}')"></div>
        <div class="menu-item-details">
          <div class="menu-item-name">${item.name}</div>
          <div class="menu-item-restaurant">${item.restaurantName}</div>
          <div class="menu-item-macros">
            <span class="macro protein">${item.protein}g protein</span>
            <span class="macro calories">${item.calories} cal</span>
            <span class="macro efficiency">${Math.round(item.proteinEfficiency)}% better than average</span>
          </div>
          <div class="menu-item-price">${item.price}</div>
        </div>
      </div>
    `).join('');
    
    container.innerHTML = itemsHTML;
  }
});