// Globe.js - Performance Optimized Interactive 3D Globe
// Cleaned version with unused code removed

class WinnerGlobe {
    constructor() {
        this.globe = null;
        this.winnersData = [];
        this.filteredData = [];
        this.customObjects = [];
        this.objectPool = new Map(); // Object pooling for pins
        this.lastUpdateTime = 0;
        this.updateThrottle = 16; // ~60fps
        
        // Performance settings
        this.maxVisiblePins = 100; // Limit visible pins for performance
        this.useInstancedRendering = true;
        
        // Cache frequently accessed DOM elements
        this.domCache = new Map();
        
        // Debounced functions
        this.debouncedFilter = this.debounce(this.performFilter.bind(this), 100);
        
        this.init();
    }

    // Utility: Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Cache DOM elements to avoid repeated queries
    getDOMElement(id) {
        if (!this.domCache.has(id)) {
            this.domCache.set(id, document.getElementById(id));
        }
        return this.domCache.get(id);
    }

    async init() {
        try {
            this.showLoading();
            
            // Load data and initialize in parallel where possible
            await this.loadWinnerData();
            await this.preloadAssets();
            
            await this.initGlobe();
            this.setupEventListeners();
            this.updateStats();
            this.hideLoading();
            
            // Start performance monitoring
            this.startPerformanceMonitoring();
            
        } catch (error) {
            console.error('Error initializing globe:', error);
            this.showError('Failed to load winner data. Please try again.');
        }
    }

    async preloadAssets() {
        // Preload 3D models and textures to avoid loading delays
        const loader = new THREE.GLTFLoader();
        try {
            const gltf = await new Promise((resolve, reject) => {
                loader.load('assets/Archive/location tag.gltf', resolve, undefined, reject);
            });
            this.baseModel = gltf.scene.children[0];
            
            // Pre-create a pool of pin objects
            this.initializeObjectPool();
        } catch (error) {
            console.warn('Could not preload 3D model, falling back to simple pins');
            this.useSimplePins = true;
        }
    }

    initializeObjectPool() {
        // Create a pool of reusable pin objects
        const poolSize = Math.min(this.maxVisiblePins, 50);
        for (let i = 0; i < poolSize; i++) {
            const pin = this.createPinObject();
            this.objectPool.set(i, { object: pin, inUse: false });
        }
    }

    createPinObject() {
        if (this.baseModel) {
            const pin = this.baseModel.clone();
            pin.traverse(child => {
                if (child.material) {
                    child.material = child.material.clone();
                }
            });
            pin.scale.set(0.8, 0.8, 0.8); // Slightly smaller for better performance
            pin.rotation.x = Math.PI / 6;
            return pin;
        } else {
            // Fallback to simple geometric pin
            const geometry = new THREE.ConeGeometry(0.02, 0.1, 8);
            const material = new THREE.MeshPhongMaterial({ color: 0xff0000 });
            return new THREE.Mesh(geometry, material);
        }
    }

    getPooledObject() {
        for (const [key, item] of this.objectPool) {
            if (!item.inUse) {
                item.inUse = true;
                return { key, object: item.object };
            }
        }
        // If pool is exhausted, create new object (shouldn't happen often)
        const pin = this.createPinObject();
        const key = this.objectPool.size;
        this.objectPool.set(key, { object: pin, inUse: true });
        return { key, object: pin };
    }

    returnToPool(key) {
        const item = this.objectPool.get(key);
        if (item) {
            item.inUse = false;
        }
    }

    showLoading() {
        const globeContainer = this.getDOMElement('globeViz');
        globeContainer.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                Loading winner data...
            </div>
        `;
    }

    hideLoading() {
        // The globe will replace the loading content
    }

    showError(message) {
        const globeContainer = this.getDOMElement('globeViz');
        globeContainer.innerHTML = `
            <div class="loading">
                <p style="color: #ff6b6b;">${message}</p>
            </div>
        `;
    }

    async loadWinnerData() {
        try {
            const response = await fetch('assets/winners.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.winnersData = await response.json();
            this.filteredData = [...this.winnersData]; // Initial filtered data
            
            // Pre-process data for better performance
            this.preprocessData();
            
        } catch (error) {
            console.error('Error loading winner data:', error);
            // If data loading fails, show error instead of sample data
            throw error;
        }
    }

    preprocessData() {
        // Add computed properties to avoid repeated calculations
        this.winnersData.forEach(winner => {
            winner.colorHex = this.getPointColor(winner);
            winner.hasValidCoords = !!(winner.lat && winner.lng);
        });
        
        // Sort by priority (can be customized)
        this.winnersData.sort((a, b) => b.year - a.year);
    }

    async initGlobe() {
        try {
            // Load geographic data efficiently
            const [countries, states] = await Promise.all([
                this.loadGeographicData('countries'),
                this.loadGeographicData('states')
            ]);
            
            const globeContainer = this.getDOMElement('globeViz');
            
            // Initialize globe with performance optimizations
            this.globe = Globe({
                rendererConfig: {
                    antialias: true,
                    alpha: false, // Disable transparency for better performance
                    powerPreference: "high-performance"
                }
            })(globeContainer)
                .backgroundColor('#d4dfed')
                .globeMaterial(new THREE.MeshPhongMaterial({ color: '#87CEFA' }))
                .polygonsData([...countries.features, ...states.features])
                .polygonCapColor(this.getPolygonColor.bind(this))
                .polygonSideColor(() => '#000000')
                .polygonAltitude(feat => feat.properties.hasOwnProperty('name') ? 0.006 : 0.005)
                .enablePointerInteraction(true);

            // Set up optimized custom objects
            await this.setupOptimizedObjects();
            
            // Set initial view
            this.globe.pointOfView({
                lat: 39.8283,
                lng: -98.5795,
                altitude: 2.0
            });
            
        } catch (err) {
            console.error('Error loading geographic data:', err);
            this.showError('Failed to load geographic data. Please check your internet connection.');
        }
    }

    async loadGeographicData(type) {
        const urls = {
            countries: 'https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson',
            states: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json'
        };
        
        const response = await fetch(urls[type]);
        return await response.json();
    }

    getPolygonColor(feat) {
        // Optimized polygon coloring
        if (feat.properties.ADMIN === 'United States of America') {
            return '#FF7F7F';
        }
        if (feat.properties.hasOwnProperty('name') && !feat.properties.ADMIN) {
            return 'rgba(0,0,0,0)';
        }
        return '#808080';
    }

    async setupOptimizedObjects() {
        // Limit visible pins for performance
        const visibleWinners = this.filteredData
            .filter(d => d.hasValidCoords)
            .slice(0, this.maxVisiblePins);

        const pins = visibleWinners.map(winner => {
            const pooledPin = this.getPooledObject();
            const pin = pooledPin.object;
            
            // Set color efficiently
            pin.traverse(child => {
                if (child.material) {
                    child.material.color.setHex(parseInt(winner.colorHex.replace('#', ''), 16));
                }
            });
            
            pin.userData = { 
                winner, 
                poolKey: pooledPin.key,
                lastUpdate: Date.now()
            };
            
            return {
                lat: winner.lat,
                lng: winner.lng,
                altitude: 0.01,
                threeObject: pin,
                winner
            };
        });

        this.customObjects = pins;
        
        this.globe
            .objectsData(this.customObjects)
            .objectLat('lat')
            .objectLng('lng')
            .objectAltitude('altitude')
            .objectThreeObject('threeObject')
            .onObjectClick(obj => this.showWinnerDetails(obj.winner))
            .onObjectHover(this.throttledHover.bind(this));

        // Optimized mouse tracking
        this.setupOptimizedMouseTracking();
    }

    throttledHover(obj, prevObj) {
        const now = Date.now();
        if (now - this.lastUpdateTime < this.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;
        
        this.handleObjectHover(obj, prevObj);
    }

    handleObjectHover(obj, prevObj) {
        // Batch DOM updates
        requestAnimationFrame(() => {
            if (prevObj && prevObj.threeObject) {
                this.resetPinOpacity(prevObj.threeObject);
            }
            
            if (obj && obj.threeObject) {
                this.setPinOpacity(obj.threeObject, 0.3);
                this.showWinnerPopup(obj.winner);
            } else {
                this.hideWinnerPopup();
            }
        });
    }

    setPinOpacity(pin, opacity) {
        pin.traverse(child => {
            if (child.material) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }

    resetPinOpacity(pin) {
        pin.traverse(child => {
            if (child.material) {
                child.material.transparent = false;
                child.material.opacity = 1;
            }
        });
    }

    setupOptimizedMouseTracking() {
        if (!this._popupMouseMoveHandler) {
            this._popupMouseMoveHandler = this.throttle((e) => {
                const popup = this.getDOMElement('winner-popup');
                if (popup && popup.style.display !== 'none') {
                    const popupWidth = popup.offsetWidth;
                    popup.style.left = (e.clientX - popupWidth / 2) + 'px';
                    popup.style.top = (e.clientY + 24) + 'px';
                    popup.style.setProperty('--pointer-x', (popupWidth / 2) + 'px');
                }
            }, 16); // ~60fps
            
            window.addEventListener('mousemove', this._popupMouseMoveHandler, { passive: true });
        }
    }

    throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    getPointColor(winner) {
        // Cached color lookup
        const colorMap = {
            'innovation': '#FF6B6B',
            'excellence': '#4ECDC4',
            'leadership': '#45B7D1',
            'community impact': '#96CEB4'
        };
        
        return colorMap[winner.category?.toLowerCase()] || '#FFFFFF';
    }

    showWinnerDetails(winner) {
        const panel = this.getDOMElement('selectedWinner');
        if (panel) {
            // Use template literals for better performance
            panel.innerHTML = `
                <div class="winner-details">
                    <div class="winner-detail"><strong>Name:</strong> ${winner.name}</div>
                    <div class="winner-detail"><strong>Location:</strong> ${winner.city}, ${winner.state}</div>
                    <div class="winner-detail"><strong>Year:</strong> ${winner.year}</div>
                    <div class="winner-detail"><strong>Prize:</strong> ${winner.prize}</div>
                    <div class="winner-detail"><strong>Category:</strong> ${winner.category}</div>
                </div>
            `;
        }
    }

    showWinnerPopup(winner) {
        const popup = this.getDOMElement('winner-popup');
        if (popup) {
            popup.innerHTML = `
                <div class="winner-popup-content">
                    <strong>${winner.name}</strong><br/>
                    <span>${winner.city}, ${winner.state}</span><br/>
                    <span>${winner.year} - ${winner.prize}</span><br/>
                    <span>Category: ${winner.category}</span>
                </div>
            `;
            popup.style.display = 'block';
        }
    }

    hideWinnerPopup() {
        const popup = this.getDOMElement('winner-popup');
        if (popup) {
            popup.style.display = 'none';
        }
    }

    setupEventListeners() {
        // Use event delegation for better performance
        document.addEventListener('click', this.handleGlobalClick.bind(this));
        
        // Handle filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.target.dataset.category;
                this.filterByCategory(category);
                
                // Update active state efficiently
                document.querySelectorAll('.filter-btn').forEach(button => 
                    button.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
    }

    handleGlobalClick(e) {
        const target = e.target;
        const id = target.id;
        
        // Only handle reset view button since it's the only one still needed
        if (id === 'resetViewBtn') {
            this.resetView();
        }
    }

    resetView() {
        if (!this.globe) return;
        
        this.globe.pointOfView({
            lat: 39.8283,
            lng: -98.5795,
            altitude: 2.0
        }, 1000);
        
        this.clearWinnerDetails();
    }

    clearWinnerDetails() {
        const panel = this.getDOMElement('selectedWinner');
        if (panel) {
            panel.innerHTML = '<p>Click on a pin to see winner details</p>';
        }
    }

    filterByCategory(category) {
        // Use debounced filtering for better performance
        this.debouncedFilter(category);
    }

    performFilter(category) {
        if (category === 'all') {
            this.filteredData = [...this.winnersData];
        } else {
            this.filteredData = this.winnersData.filter(w => w.category === category);
        }
        
        // Efficiently update visible objects
        this.updateVisibleObjects();
        this.updateStats();
    }

    updateVisibleObjects() {
        // Return unused objects to pool
        this.customObjects.forEach(obj => {
            if (obj.threeObject.userData.poolKey !== undefined) {
                this.returnToPool(obj.threeObject.userData.poolKey);
            }
        });
        
        // Create new objects for filtered data
        const visibleWinners = this.filteredData
            .filter(d => d.hasValidCoords)
            .slice(0, this.maxVisiblePins);

        this.customObjects = visibleWinners.map(winner => {
            const pooledPin = this.getPooledObject();
            const pin = pooledPin.object;
            
            pin.traverse(child => {
                if (child.material) {
                    child.material.color.setHex(parseInt(winner.colorHex.replace('#', ''), 16));
                }
            });
            
            pin.userData = { 
                winner, 
                poolKey: pooledPin.key
            };
            
            return {
                lat: winner.lat,
                lng: winner.lng,
                altitude: 0.01,
                threeObject: pin,
                winner
            };
        });
        
        // Update globe data
        this.globe.objectsData([...this.customObjects]);
    }

    updateStats() {
        // Batch DOM updates
        requestAnimationFrame(() => {
            const totalWinnersEl = this.getDOMElement('totalWinners');
            if (totalWinnersEl) {
                totalWinnersEl.textContent = this.filteredData.length;
            }
            
            const totalCategoriesEl = this.getDOMElement('totalCategories');
            if (totalCategoriesEl) {
                const uniqueCategories = [...new Set(this.filteredData.map(w => w.category))];
                totalCategoriesEl.textContent = uniqueCategories.length;
            }
            
            const totalYearsEl = this.getDOMElement('totalYears');
            if (totalYearsEl) {
                const uniqueYears = [...new Set(this.filteredData.map(w => w.year))];
                totalYearsEl.textContent = uniqueYears.length;
            }
        });
    }

    startPerformanceMonitoring() {
        // Optional: Monitor performance and adjust settings
        let frameCount = 0;
        let lastTime = performance.now();
        
        const monitor = () => {
            frameCount++;
            const currentTime = performance.now();
            
            if (currentTime - lastTime >= 1000) {
                const fps = frameCount;
                frameCount = 0;
                lastTime = currentTime;
                
                // Adjust quality based on FPS
                if (fps < 30 && this.maxVisiblePins > 25) {
                    this.maxVisiblePins = Math.max(25, this.maxVisiblePins - 10);
                    console.log(`Reduced max visible pins to ${this.maxVisiblePins} due to low FPS`);
                }
            }
            
            requestAnimationFrame(monitor);
        };
        
        requestAnimationFrame(monitor);
    }

    cleanup() {
        // Clean up resources
        window.removeEventListener('mousemove', this._popupMouseMoveHandler);
        
        // Return all objects to pool
        this.customObjects.forEach(obj => {
            if (obj.threeObject.userData.poolKey !== undefined) {
                this.returnToPool(obj.threeObject.userData.poolKey);
            }
        });
        
        this.domCache.clear();
    }
}

// Optimized initialization
function initializeGlobe() {
    if (typeof Globe === 'undefined') {
        console.error('Globe.gl library not loaded');
        const globeContainer = document.getElementById('globeViz');
        if (globeContainer) {
            globeContainer.innerHTML = `
                <div class="loading">
                    <p style="color: #ff6b6b;">3D Globe library failed to load. Please check your internet connection.</p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">Retry</button>
                </div>
            `;
        }
        return;
    }
    
    try {
        window.winnerGlobe = new WinnerGlobe();
    } catch (error) {
        console.error('Error creating WinnerGlobe:', error);
        const globeContainer = document.getElementById('globeViz');
        if (globeContainer) {
            globeContainer.innerHTML = `
                <div class="loading">
                    <p style="color: #ff6b6b;">Failed to initialize the globe. Please refresh the page.</p>
                    <button onclick="location.reload()" style="margin-top: 10px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">Retry</button>
                </div>
            `;
        }
    }
}

// Use more efficient initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGlobe, { once: true });
} else {
    initializeGlobe();
}

// Export for potential use in other scripts
window.WinnerGlobe = WinnerGlobe;