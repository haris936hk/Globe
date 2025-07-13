// Globe.js - Fixed Interactive 3D Globe with Winner Locations
// Use global THREE and CustomMapPin (from UMD scripts)

class WinnerGlobe {
    constructor() {
        this.globe = null;
        this.winnersData = [];
        this.isAutoRotating = false;
        this.animationSpeed = 0.5;
        this.pinFactory = null;
        this.animationId = null;
        this.startTime = Date.now();
        this.useCustomPins = true;
        this.customObjects = [];
        
        this.init();
    }

    async init() {
        try {
            // Show loading
            this.showLoading();
            
            // Load winner data
            await this.loadWinnerData();
            
            // Initialize globe
            await this.initGlobe();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Update stats
            this.updateStats();
            
            // Hide loading
            this.hideLoading();
            
        } catch (error) {
            console.error('Error initializing globe:', error);
            this.showError('Failed to load winner data. Please try again.');
        }
    }

    showLoading() {
        const globeContainer = document.getElementById('globeViz');
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
        const globeContainer = document.getElementById('globeViz');
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
        } catch (error) {
            console.error('Error loading winner data:', error);
            // Fallback to sample data if JSON fails to load
            this.winnersData = this.getSampleData();
        }
    }

    getSampleData() {
        return [
            {
                "name": "John Doe",
                "city": "Dallas",
                "state": "TX",
                "lat": 32.7767,
                "lng": -96.7970,
                "year": 2023,
                "prize": "$50,000",
                "category": "Innovation"
            },
            {
                "name": "Jane Smith",
                "city": "Denver",
                "state": "CO",
                "lat": 39.7392,
                "lng": -104.9903,
                "year": 2023,
                "prize": "$25,000",
                "category": "Community Impact"
            },
            {
                "name": "Bob Johnson",
                "city": "Miami",
                "state": "FL",
                "lat": 25.7617,
                "lng": -80.1918,
                "year": 2023,
                "prize": "$30,000",
                "category": "Leadership"
            }
        ];
    }

    async initGlobe() {
        try {
            const [countries, states] = await Promise.all([
                fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson').then(res => res.json()),
                fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json').then(res => res.json())
            ]);
            
            const globeContainer = document.getElementById('globeViz');

            // Create the globe instance
            this.globe = Globe()(globeContainer)
                .backgroundColor('#FFFFFF')
                .globeMaterial(new THREE.MeshPhongMaterial({ color: '#F5F5F5' }))
                .polygonsData([...countries.features, ...states.features])
                .polygonCapColor(feat => feat.properties.hasOwnProperty('name') ? 'rgba(0, 0, 0, 0)' : '#B41F27')
                .polygonSideColor(() => '#000000')
                .polygonAltitude(feat => feat.properties.hasOwnProperty('name') ? 0.006 : 0.005)
                .enablePointerInteraction(true);

            // Use custom SVG pin objects
            await this.setupCustomObjects();

            // Responsive altitude based on window size
            const getResponsiveAltitude = () => {
                if (window.innerWidth < 500) return 3.2;
                if (window.innerWidth < 900) return 2.5;
                return 2.0;
            };

            // Set initial view to center on US
            this.globe.pointOfView({
                lat: 39.8283,
                lng: -98.5795,
                altitude: getResponsiveAltitude()
            });

            // Update zoom on resize
            window.addEventListener('resize', () => {
                this.globe.pointOfView({
                    lat: 39.8283,
                    lng: -98.5795,
                    altitude: getResponsiveAltitude()
                });
            });
        } catch (err) {
            console.error('Error loading geographic data:', err);
            this.showError('Failed to load geographic data. Please check your internet connection.');
        }
    }

    async setupCustomObjects() {
        // Load the GLTF pin model once
        const loader = new THREE.GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
            loader.load('assets/Archive/location tag.gltf', resolve, undefined, reject);
        });
        // Find the main mesh in the loaded scene
        const baseObject = gltf.scene.children[0];

        const pins = this.winnersData.filter(d => d.lat && d.lng).map(winner => {
            // Clone the model for each winner
            const pin = baseObject.clone();
            pin.scale.set(1, 1, 1); // Reduced size by 50%
            // Tilt the pin by 30 degrees (Math.PI/6 radians) around the X axis
            pin.rotation.x = Math.PI / 6;
            pin.userData = { winner };
            return {
                lat: winner.lat,
                lng: winner.lng,
                altitude: 0.02, // Closer to the globe
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
            .onObjectHover(obj => obj ? this.showWinnerDetails(obj.winner) : this.clearWinnerDetails());
    }

    setupFallbackPoints() {
        console.log('Setting up fallback points');
        
        this.globe
            .pointsData(this.winnersData.filter(d => d.lat && d.lng))
            .pointLat(d => d.lat)
            .pointLng(d => d.lng)
            .pointColor(d => this.getPointColor(d))
            .pointAltitude(0.02)
            .pointRadius(2.5)
            .pointLabel(d => this.getPointLabel(d))
            .onPointClick(this.onPointClick.bind(this))
            .onPointHover(this.onPointHover.bind(this));
    }

    async createCustomPin(winner) {
        if (!this.pinFactory) {
            console.warn('Pin factory not available');
            return null;
        }
        
        try {
            // Get color based on category
            const color = this.getPointColor(winner);
            
            // Create animated pin for better visual appeal (now async)
            const pin = await this.pinFactory.createAnimatedPin(color, 1.0);
            
            // Store winner data for later reference
            pin.userData = {
                ...pin.userData,
                winner: winner,
                originalColor: color
            };
            
            return pin;
        } catch (error) {
            console.error('Error creating custom pin for', winner.name, ':', error);
            return null;
        }
    }

    getPointColor(winner) {
        // Return different colors based on category, as per README
        if (winner.category) {
            switch(winner.category.toLowerCase()) {
                case 'innovation':
                    return '#FF6B6B'; // Red
                case 'excellence':
                    return '#4ECDC4'; // Teal
                case 'leadership':
                    return '#45B7D1'; // Blue
                case 'community impact':
                    return '#96CEB4'; // Green
                default:
                    return '#FFFFFF'; // Default white
            }
        }
        return '#FFFFFF'; // Default white
    }

    getPointLabel(winner) {
        return `
            <div style="background: rgba(0,0,0,0.8); padding: 10px; border-radius: 5px; color: white; font-size: 12px; max-width: 200px;">
                <strong>${winner.name}</strong><br/>
                ${winner.city}, ${winner.state}<br/>
                ${winner.year} - ${winner.prize}<br/>
                Category: ${winner.category}
            </div>
        `;
    }

    onPointClick(point) {
        if (point) {
            this.showWinnerDetails(point);
            // Animate to point
            this.globe.pointOfView({
                lat: point.lat,
                lng: point.lng,
                altitude: 1.5
            }, 1000);
        }
    }

    onPointHover(point) {
        if (point) {
            this.showWinnerDetails(point);
        } else {
            this.clearWinnerDetails();
        }
    }

    showWinnerDetails(winner) {
        const panel = document.getElementById('selectedWinner');
        if (panel) {
            panel.innerHTML = `
                <div class="winner-details">
                    <div class="winner-detail">
                        <strong>Name:</strong> ${winner.name}
                    </div>
                    <div class="winner-detail">
                        <strong>Location:</strong> ${winner.city}, ${winner.state}
                    </div>
                    <div class="winner-detail">
                        <strong>Year:</strong> ${winner.year}
                    </div>
                    <div class="winner-detail">
                        <strong>Prize:</strong> ${winner.prize}
                    </div>
                    <div class="winner-detail">
                        <strong>Category:</strong> ${winner.category}
                    </div>
                </div>
            `;
        }
    }

    clearWinnerDetails() {
        const panel = document.getElementById('selectedWinner');
        if (panel) {
            panel.innerHTML = '<p>Hover over a pin to see winner details</p>';
        }
    }

    startPinAnimation() {
        if (!this.globe || !this.pinFactory || !this.useCustomPins) return;
        
        const animate = () => {
            const time = (Date.now() - this.startTime) * 0.001;
            
            // Update all custom objects
            if (this.customObjects && this.customObjects.length > 0) {
                this.customObjects.forEach(obj => {
                    if (obj.threeObject && obj.threeObject.userData && obj.threeObject.userData.isAnimated) {
                        this.pinFactory.updateAnimation(obj.threeObject, time);
                    }
                });
            }
            
            this.animationId = requestAnimationFrame(animate);
        };
        
        animate();
    }

    stopPinAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    setupEventListeners() {
        // Auto-rotate toggle
        const autoRotateBtn = document.getElementById('autoRotateBtn');
        if (autoRotateBtn) {
            autoRotateBtn.addEventListener('click', () => {
                this.toggleAutoRotate();
            });
        }

        // Animate pins
        const animatePinsBtn = document.getElementById('animatePinsBtn');
        if (animatePinsBtn) {
            animatePinsBtn.addEventListener('click', () => {
                this.animatePins();
            });
        }

        // Reset view
        const resetViewBtn = document.getElementById('resetViewBtn');
        if (resetViewBtn) {
            resetViewBtn.addEventListener('click', () => {
                this.resetView();
            });
        }

        // Change pin style
        const changePinStyleBtn = document.getElementById('changePinStyleBtn');
        if (changePinStyleBtn) {
            changePinStyleBtn.addEventListener('click', () => {
                this.changePinStyle();
            });
        }

        // Category filter buttons
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const category = e.target.dataset.category;
                this.filterByCategory(category);
                
                // Update active state
                filterButtons.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
    }

    toggleAutoRotate() {
        this.isAutoRotating = !this.isAutoRotating;
        const button = document.getElementById('autoRotateBtn');
        
        if (this.isAutoRotating) {
            button.textContent = '🔄 Stop Auto Rotate';
            button.style.background = 'rgba(255, 107, 107, 0.3)';
            this.startAutoRotate();
        } else {
            button.textContent = '🔄 Auto Rotate';
            button.style.background = 'rgba(255, 255, 255, 0.2)';
            this.stopAutoRotate();
        }
    }

    startAutoRotate() {
        if (!this.globe) return;
        
        this.globe.controls().autoRotate = true;
        this.globe.controls().autoRotateSpeed = this.animationSpeed;
    }

    stopAutoRotate() {
        if (!this.globe) return;
        
        this.globe.controls().autoRotate = false;
    }

    animatePins() {
        if (!this.winnersData || this.winnersData.length === 0) return;
        
        let index = 0;
        const animateNext = () => {
            if (index < this.winnersData.length) {
                const winner = this.winnersData[index];
                
                // Animate to winner location
                this.globe.pointOfView({
                    lat: winner.lat,
                    lng: winner.lng,
                    altitude: 1.2
                }, 1000);

                // Show winner details
                this.showWinnerDetails(winner);
                
                index++;
                setTimeout(animateNext, 2000);
            } else {
                // Reset view after animation
                setTimeout(() => {
                    this.resetView();
                }, 1000);
            }
        };
        
        animateNext();
    }

    resetView() {
        if (!this.globe) return;
        
        // Responsive altitude based on window size
        const getResponsiveAltitude = () => {
            if (window.innerWidth < 500) return 3.2;
            if (window.innerWidth < 900) return 2.5;
            return 2.0;
        };
        
        // Reset to US view
        this.globe.pointOfView({
            lat: 39.8283,
            lng: -98.5795,
            altitude: getResponsiveAltitude()
        }, 1000);
        
        // Clear winner details
        this.clearWinnerDetails();
    }

    changePinStyle() {
        if (!this.globe || !this.pinFactory || !this.useCustomPins) return;
        try {
            // Create a new array with new pin objects
            const colors = ['#1A237E', '#4CAF50', '#2196F3', '#FFD700', '#9C27B0'];
            const newObjects = this.customObjects.map((obj, index) => {
                const colorIndex = index % colors.length;
                const newPin = this.pinFactory.createAnimatedPin(colors[colorIndex], 1.0);
                newPin.userData = {
                    ...newPin.userData,
                    winner: obj.winner || obj
                };
                return {
                    ...obj,
                    threeObject: newPin
                };
            });
            // Update the reference and refresh the globe
            this.customObjects = newObjects;
            this.globe.objectsData([...this.customObjects]);
        } catch (error) {
            console.error('Error changing pin style:', error);
        }
    }

    updateStats() {
        // Update total winners
        const totalWinnersEl = document.getElementById('totalWinners');
        if (totalWinnersEl) {
            totalWinnersEl.textContent = this.winnersData.length;
        }
        
        // Update total categories
        const totalCategoriesEl = document.getElementById('totalCategories');
        if (totalCategoriesEl) {
            const uniqueCategories = [...new Set(this.winnersData.map(w => w.category))];
            totalCategoriesEl.textContent = uniqueCategories.length;
        }
        
        // Update total years
        const totalYearsEl = document.getElementById('totalYears');
        if (totalYearsEl) {
            const uniqueYears = [...new Set(this.winnersData.map(w => w.year))];
            totalYearsEl.textContent = uniqueYears.length;
        }
    }

    filterByCategory(category) {
        if (category === 'all') {
            // Show all winners
            if (this.useCustomPins && this.customObjects.length > 0) {
                this.globe.objectsData(this.customObjects);
            } else {
                this.globe.pointsData(this.winnersData.filter(d => d.lat && d.lng));
            }
        } else {
            // Filter by specific category
            const filteredWinners = this.winnersData.filter(w => w.category === category);
            
            if (this.useCustomPins && this.customObjects.length > 0) {
                const filteredObjects = this.customObjects.filter(obj => 
                    obj.winner && obj.winner.category === category
                );
                this.globe.objectsData(filteredObjects);
            } else {
                this.globe.pointsData(filteredWinners.filter(d => d.lat && d.lng));
            }
        }
        
        // Update stats for filtered data
        this.updateStats();
    }

    // Cleanup method to stop animations
    cleanup() {
        this.stopPinAnimation();
        this.stopAutoRotate();
    }
}

// Initialize the globe when the page loads
function initializeGlobe() {
    // Check if required libraries are available
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

// Multiple ways to ensure initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGlobe);
} else {
    // DOM is already ready
    initializeGlobe();
}

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (window.winnerGlobe) {
        switch(e.key) {
            case 'r':
            case 'R':
                const autoRotateBtn = document.getElementById('autoRotateBtn');
                if (autoRotateBtn) autoRotateBtn.click();
                break;
            case 'a':
            case 'A':
                const animatePinsBtn = document.getElementById('animatePinsBtn');
                if (animatePinsBtn) animatePinsBtn.click();
                break;
            case 'p':
            case 'P':
                const changePinStyleBtn = document.getElementById('changePinStyleBtn');
                if (changePinStyleBtn) changePinStyleBtn.click();
                break;
            case 'Escape':
                const resetViewBtn = document.getElementById('resetViewBtn');
                if (resetViewBtn) resetViewBtn.click();
                break;
        }
    }
});

// Export for potential use in other scripts
window.WinnerGlobe = WinnerGlobe;