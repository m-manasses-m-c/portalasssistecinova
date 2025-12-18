const { createApp } = Vue;
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            publicForms: [],
            loadingForms: true,
            cookiesAccepted: false,
            expandedFormId: null,
            currentTab: 'home', // 'home', 'contacts'
            
            // Document Viewer Modal
            showDocModal: false,
            currentDocUrl: '',
            currentDocName: '',

            // Search & Filter
            searchQuery: '',
            selectedCategory: '',
            
            // Timeline Animation
            focusedIndex: -1,

            // Managers Data
            managers: [
                {
                    name: 'Lorem Ipsum',
                    role: 'Lorem Ipsum',
                    description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.',
                    photo: 'https://randomuser.me/api/portraits/men/32.jpg'
                },
                {
                    name: 'Lorem Ipsum',
                    role: 'Lorem Ipsum',
                    description: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
                    photo: 'https://randomuser.me/api/portraits/women/44.jpg'
                },
                {
                    name: 'Lorem Ipsum',
                    role: 'Lorem Ipsum',
                    description: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
                    photo: 'https://randomuser.me/api/portraits/men/85.jpg'
                },
                {
                    name: 'Lorem Ipsum',
                    role: 'Lorem Ipsum',
                    description: 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
                    photo: 'https://randomuser.me/api/portraits/women/65.jpg'
                },
                {
                    name: 'Lorem Ipsum',
                    role: 'Lorem Ipsum',
                    description: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
                    photo: 'https://randomuser.me/api/portraits/men/22.jpg'
                },
                {
                    name: 'Lorem Ipsum',
                    role: 'Lorem Ipsum',
                    description: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur.',
                    photo: 'https://randomuser.me/api/portraits/women/28.jpg'
                }
            ],
            teamMembers: [
                { name: 'Lorem Ipsum', role: 'Lorem Ipsum' },
                { name: 'Lorem Ipsum', role: 'Lorem Ipsum' },
                { name: 'Lorem Ipsum', role: 'Lorem Ipsum' },
                { name: 'Lorem Ipsum', role: 'Lorem Ipsum' },
                { name: 'Lorem Ipsum', role: 'Lorem Ipsum' },
                { name: 'Lorem Ipsum', role: 'Lorem Ipsum' }
            ]
        }
    },
    watch: {
        timelineItems() {
            this.$nextTick(() => {
                this.handleScroll();
            });
        }
    },
    computed: {
        timelineItems() {
            if (!this.publicForms.length) return [];

            // 1. Filter
            let filtered = this.publicForms.filter(f => {
                const matchText = (f.title + f.description).toLowerCase().includes(this.searchQuery.toLowerCase());
                const matchCat = this.selectedCategory ? f.category === this.selectedCategory : true;
                return matchText && matchCat;
            });

            // 2. Sort by Start Date (Newest First)
            filtered.sort((a, b) => {
                const dateA = a.start_date ? new Date(a.start_date) : new Date(a.created_at);
                const dateB = b.start_date ? new Date(b.start_date) : new Date(b.created_at);
                return dateB - dateA;
            });

            // 3. Group by Year/Month for Timeline Dividers
            const years = {};
            filtered.forEach(form => {
                const date = form.start_date ? new Date(form.start_date) : new Date(form.created_at);
                const year = date.getFullYear();
                const monthKey = date.getMonth(); // 0-11
                const monthLabel = date.toLocaleString('pt-BR', { month: 'long' });
                const monthCapitalized = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

                if (!years[year]) years[year] = {};
                if (!years[year][monthKey]) years[year][monthKey] = { label: monthCapitalized, items: [] };
                years[year][monthKey].items.push(form);
            });

            const items = [];
            // Sort Years Descending
            Object.keys(years).sort((a, b) => b - a).forEach(year => {
                const months = years[year];
                // Sort Months Descending
                Object.keys(months).sort((a, b) => b - a).forEach(monthKey => {
                    const monthGroup = months[monthKey];
                    // Add Month Divider
                    items.push({ type: 'divider-month', label: monthGroup.label });
                    // Add Items
                    monthGroup.items.forEach(item => {
                        items.push({ type: 'form', data: item });
                    });
                });
                // Add Year Divider (At the bottom of the year group)
                items.push({ type: 'divider-year', label: year });
            });

            return items;
        },
        uniqueCategories() {
            const cats = new Set(this.publicForms.map(f => f.category).filter(Boolean));
            return Array.from(cats);
        }
    },
    mounted() {
        this.checkCookies();
        this.fetchPublicForms();
    },
    methods: {
        onCardClick(index, id) {
            // 1. Toggle Expand
            this.toggleExpand(id);

            // 2. Center & Magnify (Scroll into view)
            const el = document.getElementById('item-' + index);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // The handleScroll listener will automatically update focusedIndex
                // but we can set it immediately for responsiveness
                this.focusedIndex = index;
            }
        },
        toggleExpand(id) {
            if (this.expandedFormId === id) {
                this.expandedFormId = null;
            } else {
                this.expandedFormId = id;
            }
        },
        handleScroll() {
            const container = this.$refs.timelineContainer;
            if (!container) return;

            const containerRect = container.getBoundingClientRect();
            const containerCenter = containerRect.top + containerRect.height / 2;

            let closestIndex = -1;
            let minDistance = Infinity;

            this.timelineItems.forEach((item, index) => {
                // Apply effect to ALL items (forms, years, months)
                const el = document.getElementById('item-' + index);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const itemCenter = rect.top + rect.height / 2;
                    const distance = Math.abs(containerCenter - itemCenter);

                    if (distance < minDistance) {
                        minDistance = distance;
                        closestIndex = index;
                    }
                }
            });

            this.focusedIndex = closestIndex;
        },
        checkCookies() {
            this.cookiesAccepted = localStorage.getItem('cookiesAccepted') === 'true';
        },
        acceptCookies() {
            this.cookiesAccepted = true;
            localStorage.setItem('cookiesAccepted', 'true');
        },
        async fetchPublicForms() {
            this.loadingForms = true;
            try {
                const { data, error } = await supabase.rpc('get_public_forms');
                if (error) throw error;
                this.publicForms = data || [];
            } catch (error) {
                console.error('Erro ao carregar formulários:', error);
                alert('Erro ao carregar processos seletivos.');
            } finally {
                this.loadingForms = false;
            }
        },
        selectForm(form) {
            // Redirect to the form page with the form ID
            window.location.href = `form.html?id=${form.id}`;
        },
        formatDateRange(startDate, endDate) {
            if (!startDate) return '';
            const start = new Date(startDate).toLocaleDateString('pt-BR');
            if (!endDate) return start;
            const end = new Date(endDate).toLocaleDateString('pt-BR');
            return `${start} a ${end}`;
        },
        getCategoryColor(category) {
            const colors = {
                'Edital': 'bg-blue-100 text-blue-700 border-blue-200',
                'Pesquisa': 'bg-purple-100 text-purple-700 border-purple-200',
                'Evento': 'bg-green-100 text-green-700 border-green-200',
                'Outro': 'bg-gray-100 text-gray-700 border-gray-200'
            };
            return colors[category] || colors['Outro'];
        },
        getCategoryIcon(category) {
            const icons = {
                'Edital': 'fa-file-signature',
                'Pesquisa': 'fa-magnifying-glass-chart',
                'Evento': 'fa-calendar-day',
                'Outro': 'fa-clipboard-list'
            };
            return icons[category] || icons['Outro'];
        },
        openDocument(doc) {
            this.currentDocName = doc.name;
            this.currentDocUrl = doc.url;
            this.showDocModal = true;
        },
        closeDocument() {
            this.showDocModal = false;
            this.currentDocUrl = '';
            this.currentDocName = '';
        }
    }
}).mount('#app');
