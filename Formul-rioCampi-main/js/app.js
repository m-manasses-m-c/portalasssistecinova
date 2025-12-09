const { createApp } = Vue;

// Use the client initialized in config.js
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            currentView: 'form', // Default to form page
            adminTab: 'charts',
            loading: false, 
            cookiesAccepted: false,
            savingDates: false,

            form: { name: '', email: '', ict: '', selectedCampi: [] },
            
            searchIct: '',
            showIctDropdown: false,
            searchCampus: '',
            showCampusDropdown: false, 
            
            adminPassword: '',
            loginError: false,
            importText: '',
            importMessage: '',
            importError: false,
            chartInstance: null,
            allIcts: [], 
            allCampi: [], 
            dbSubmissions: [],
            expandedICTs: [],
            campusDates: {}, 
            selectedDayDetails: null,
            showDayModal: false,

            // --- NOVO: Estado para a tela de sucesso ---
            successData: {
                accessKey: null,
                isNew: false
            },
            
            // --- NOVO: Estado do Formulário ---
            formId: null,
            formTitle: 'Carregando...',
            formDescription: '',
            badgeText: '2025',

            // --- NOVO: Landing Page ---
            publicForms: [],
            loadingForms: false
        }
    },
    watch: {
        uniqueCampiFlatList: {
            handler() {
                this.syncDates();
            },
            deep: true
        }
    },
    computed: {
        filteredIcts() {
            if (!this.searchIct) return this.allIcts.slice(0, 10);
            const term = this.searchIct.toLowerCase();
            return this.allIcts.filter(ict => ict.toLowerCase().includes(term)).slice(0, 20);
        },
        filteredAvailableCampi() {
            if (!this.form.ict) return []; 
            let term = this.searchCampus.toLowerCase();
            return this.allCampi.filter(c => 
                c.ictName === this.form.ict && 
                c.name.toLowerCase().includes(term) && 
                !this.form.selectedCampi.some(sel => sel.id === c.id)
            ).slice(0, 50);
        },
        consolidatedData() {
            const ictMap = {};
            this.dbSubmissions.forEach(sub => {
                if(!sub.ict || !sub.campi) return;
                if (!ictMap[sub.ict]) {
                    ictMap[sub.ict] = {
                        ictName: sub.ict,
                        uniqueCampiIds: new Set(),
                        uniqueCampiNames: new Set(),
                        respondents: new Set()
                    };
                }
                if(sub.email) ictMap[sub.ict].respondents.add(sub.email);
                if(Array.isArray(sub.campi)) {
                    sub.campi.forEach(c => {
                        ictMap[sub.ict].uniqueCampiIds.add(c.id);
                        ictMap[sub.ict].uniqueCampiNames.add(c.name);
                    });
                }
            });
            return Object.values(ictMap).map(item => ({
                ...item,
                uniqueCampiCount: item.uniqueCampiIds.size
            })).sort((a, b) => b.uniqueCampiCount - a.uniqueCampiCount);
        },
        globalUniqueCampi() {
            return this.consolidatedData.reduce((acc, curr) => acc + curr.uniqueCampiCount, 0);
        },
        uniqueCampiFlatList() {
            let list = [];
            this.consolidatedData.forEach(ict => {
                ict.uniqueCampiNames.forEach(campusName => {
                    const original = this.allCampi.find(c => c.name === campusName && c.ictName === ict.ictName);
                    const id = original ? original.id : (ict.ictName + campusName);
                    
                    list.push({
                        id: id,
                        ict: ict.ictName,
                        name: campusName,
                        fullLabel: `${ict.ictName} - ${campusName}`
                    });
                });
            });
            return list.sort((a,b) => a.ict.localeCompare(b.ict));
        },
        calendarMonths() {
            const months = [];
            const startDate = new Date(2025, 11, 1); 
            const endDate = new Date(2026, 11, 31);
            
            let current = new Date(startDate);

            while (current <= endDate) {
                const year = current.getFullYear();
                const month = current.getMonth();
                
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const firstDayWeekday = new Date(year, month, 1).getDay(); 
    
                const daysObj = [];
                for(let i=0; i<firstDayWeekday; i++) {
                    daysObj.push({ day: '', empty: true });
                }
                for(let d=1; d<=daysInMonth; d++) {
                    const dateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const stats = this.calculateDayStats(dateStr);
                    
                    daysObj.push({
                        day: d,
                        date: dateStr,
                        empty: false,
                        stats: stats
                    });
                }

                months.push({
                    name: new Date(year, month).toLocaleString('pt-BR', { month: 'long', year: 'numeric' }),
                    days: daysObj
                });

                current.setMonth(current.getMonth() + 1);
            }
            return months;
        }
    },
    methods: {
        syncDates() {
            this.uniqueCampiFlatList.forEach(campus => {
                if (!this.campusDates[campus.id]) {
                    this.campusDates[campus.id] = { recessStart: '', recessEnd: '', vacStart: '', vacEnd: '' };
                }
            });
        },

        /* ---- BULK DATE FUNCTIONALITY (Scoped by ICT) ---- */
        isFirstOfIct(index) {
            if (index === 0) return true;
            const prev = this.uniqueCampiFlatList[index - 1];
            const curr = this.uniqueCampiFlatList[index];
            return prev.ict !== curr.ict;
        },
        applyToIct(sourceCampus, fieldKey) {
            const ictName = sourceCampus.ict;
            const value = this.campusDates[sourceCampus.id][fieldKey];
            
            if (!value) return; 

            this.uniqueCampiFlatList.forEach(c => {
                if (c.ict === ictName) {
                    this.campusDates[c.id][fieldKey] = value;
                }
            });
        },

        /* ---- EXCEL EXPORT FUNCTIONALITY ---- */
        exportToExcel() {
            if (this.dbSubmissions.length === 0) {
                alert("Não há dados para exportar.");
                return;
            }

            // Flatten data structure for Excel
            const rows = [];
            this.dbSubmissions.forEach(sub => {
                if (Array.isArray(sub.campi)) {
                    sub.campi.forEach(campus => {
                        rows.push({
                            "ID Resposta": sub.id,
                            "Data Cadastro": new Date(sub.created_at).toLocaleString('pt-BR'),
                            "Nome Responsável": sub.name,
                            "Email Responsável": sub.email,
                            "ICT": sub.ict,
                            "Campus": campus.name,
                            "ID Campus": campus.id
                        });
                    });
                } else {
                    rows.push({
                        "ID Resposta": sub.id,
                        "Data Cadastro": new Date(sub.created_at).toLocaleString('pt-BR'),
                        "Nome Responsável": sub.name,
                        "Email Responsável": sub.email,
                        "ICT": sub.ict,
                        "Campus": "N/A"
                    });
                }
            });

            // Generate Worksheet
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Adesoes_2025");

            // Trigger Download
            XLSX.writeFile(workbook, `Relatorio_Adesao_${new Date().toISOString().slice(0,10)}.xlsx`);
        },

        toggleIctExpansion(ictName) {
            const idx = this.expandedICTs.indexOf(ictName);
            if (idx > -1) {
                this.expandedICTs.splice(idx, 1);
            } else {
                this.expandedICTs.push(ictName);
            }
        },
        isIctExpanded(ictName) {
            return this.expandedICTs.includes(ictName);
        },

        delayHideIct() { setTimeout(() => { this.showIctDropdown = false; }, 200); },
        delayHideCampus() { setTimeout(() => { this.showCampusDropdown = false; }, 200); },
        checkCookies() { if (localStorage.getItem('cookiesAccepted')) this.cookiesAccepted = true; },
        acceptCookies() { localStorage.setItem('cookiesAccepted', 'true'); this.cookiesAccepted = true; },
        
        async fetchGlobalConfig() {
            try {
                const { data } = await supabase.from('app_config').select('*').eq('id', 1).single();
                if (data) {
                    if (data.icts && data.icts.length > 0) {
                        this.allIcts = data.icts;
                    } else {
                        // Fallback if DB has empty array
                        this.loadDefaultData();
                    }
                    
                    if (data.campi && data.campi.length > 0) {
                        this.allCampi = data.campi;
                    }
                } else { 
                    this.loadDefaultData(); 
                }
            } catch (e) { 
                console.error("Erro ao carregar config:", e);
                this.loadDefaultData(); 
            }
        },
        loadDefaultData() {
            this.allIcts = ['IFSP - Instituto Federal de São Paulo'];
            this.allCampi = [{ id: 1, name: 'Campus São Paulo', ictName: 'IFSP - Instituto Federal de São Paulo' }];
        },
        async processImport() {
            if (!this.importText.trim()) { this.importError = true; this.importMessage = "Área de texto vazia."; return; }
            this.importMessage = "Processando..."; this.importError = false;
            try {
                const rows = this.importText.split('\n');
                const tempIcts = new Set(); const tempCampi = []; let idCounter = 1;
                rows.forEach(row => {
                    const cols = row.split('\t');
                    if (cols.length >= 3) {
                        const sigla = cols[0].trim(); const nome = cols[1].trim(); const campus = cols[2].trim();
                        if(sigla && nome && campus) {
                            const ictFullName = `${sigla} - ${nome}`;
                            tempIcts.add(ictFullName);
                            tempCampi.push({ id: idCounter++, name: campus, ictName: ictFullName });
                        }
                    }
                });
                if (tempIcts.size === 0) throw new Error("Formato inválido.");
                const newIcts = Array.from(tempIcts).sort();
                const { error } = await supabase.from('app_config').upsert({ id: 1, icts: newIcts, campi: tempCampi, updated_at: new Date() });
                if (error) throw error;
                this.allIcts = newIcts; this.allCampi = tempCampi;
                this.importError = false; this.importMessage = `Sucesso! Base atualizada.`;
            } catch (e) { this.importError = true; this.importMessage = "Erro: " + e.message; }
        },
        selectIct(ictName) { this.form.ict = ictName; this.searchIct = ''; this.showIctDropdown = false; this.form.selectedCampi = []; },
        resetIctSelection() { this.form.ict = ''; this.form.selectedCampi = []; this.searchCampus = ''; },
        addCampus(campus) { this.form.selectedCampi.push({ ...campus, addedAt: new Date().toISOString() }); this.searchCampus = ''; },
        tryAddFirstMatch() { if (this.filteredAvailableCampi.length > 0) this.addCampus(this.filteredAvailableCampi[0]); },
        removeCampus(index) { this.form.selectedCampi.splice(index, 1); },
        resetForm() { 
            this.form = { name: '', email: '', ict: '', selectedCampi: [] }; 
            this.resetIctSelection(); 
            this.successData = { accessKey: null, isNew: false }; // <-- Limpa os dados de sucesso
        },
        copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                alert(`Chave "${text}" copiada para a área de transferência!`);
            }, () => {
                alert('Falha ao copiar a chave.');
            });
        },
        async loadFormDetails() {
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            
            // Prioritize URL ID, then internal state ID
            if (id) {
                this.formId = parseInt(id);
                this.currentView = 'form'; // Switch to form view if ID is in URL
            }
            
            if (this.formId) {
                try {
                    const { data, error } = await supabase
                        .from('forms')
                        .select('title, description, badge_text')
                        .eq('id', this.formId)
                        .single();
                        
                    if (error) throw error;
                    
                    if (data) {
                        this.formTitle = data.title;
                        this.formDescription = data.description;
                        if (data.badge_text) this.badgeText = data.badge_text;
                        document.title = data.title + " - Assistec";
                    }
                } catch (e) {
                    console.error("Erro ao carregar formulário:", e);
                    this.formTitle = "Formulário não encontrado";
                }
            } else {
                // If no ID, redirect to landing page
                window.location.href = 'index.html';
            }
        },

        // --- Landing Page Methods ---
        async fetchPublicForms() {
            this.loadingForms = true;
            try {
                const { data, error } = await supabase.rpc('get_public_forms');
                if (error) throw error;
                this.publicForms = data || [];
            } catch (e) {
                console.error("Erro ao carregar processos:", e);
            } finally {
                this.loadingForms = false;
            }
        },
        selectForm(form) {
            this.formId = form.id;
            this.formTitle = form.title;
            this.formDescription = form.description;
            this.badgeText = form.badge_text || 'Novo';
            this.currentView = 'form';
            window.scrollTo(0, 0);
            // Optionally update URL without reload
            const url = new URL(window.location);
            url.searchParams.set('id', form.id);
            window.history.pushState({}, '', url);
        },
        getCategoryColor(category) {
            const colors = {
                'Edital': 'bg-blue-100 text-blue-700',
                'Pesquisa': 'bg-purple-100 text-purple-700',
                'Evento': 'bg-green-100 text-green-700',
                'Outro': 'bg-slate-100 text-slate-700'
            };
            return colors[category] || colors['Outro'];
        },

        checkCookies() {
            if (localStorage.getItem('cookiesAccepted')) {
                this.cookiesAccepted = true;
            }
        },
        acceptCookies() {
            localStorage.setItem('cookiesAccepted', 'true');
            this.cookiesAccepted = true;
        },

        async submitForm() {
            if (!this.form.ict || this.form.selectedCampi.length === 0 || !this.form.name || !this.form.email) {
                alert("Preencha todos os campos de identificação, ICT e selecione ao menos um campus.");
                return;
            }
            
            if (!this.formId) {
                alert("Erro: Identificador do formulário não encontrado.");
                return;
            }

            this.loading = true;
            try {
                // Chama a nova função RPC segura
                const { data, error } = await supabase.rpc('submit_form_and_get_key', {
                    p_name: this.form.name,
                    p_email: this.form.email,
                    p_ict: this.form.ict,
                    p_campi: this.form.selectedCampi,
                    p_form_id: this.formId
                });

                if (error) throw error;

                // Armazena os dados de sucesso para exibir na próxima tela
                if (data && data.length > 0) {
                    this.successData.accessKey = data[0].access_key;
                    this.successData.isNew = data[0].is_new;
                }

                this.currentView = 'success';
                // Não limpa o formulário aqui para que os dados possam ser usados na tela de sucesso se necessário

            } catch (error) {
                alert("Erro ao submeter o formulário: " + error.message);
            } finally {
                this.loading = false;
            }
        },

        // Utility method to copy access key to clipboard
        copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                alert('Chave de acesso copiada com sucesso!');
            }).catch(err => {
                console.error('Erro ao copiar:', err);
                alert('Erro ao copiar a chave. Tente novamente.');
            });
        },

        /* ---- LOGIN AND SESSION LOGIC ---- */
        toggleAdmin() { 
            if(this.currentView === 'dashboard') return;
            this.currentView = 'adminLogin'; 
            this.loginError = false; 
            this.adminPassword = ''; 
        },
        logout() {
            localStorage.removeItem('assistec_admin_session');
            this.currentView = 'form';
            this.adminPassword = '';
            this.dbSubmissions = [];
        },
        async checkSession() {
            const session = localStorage.getItem('assistec_admin_session');
            if (session) {
                const expiry = parseInt(session);
                if (Date.now() < expiry) {
                    await this.initAdminView();
                } else {
                    localStorage.removeItem('assistec_admin_session');
                }
            }
        },
        async checkLogin() {
            this.loading = true;
            this.loginError = false;

            try {
                const { data: isValid, error: rpcError } = await supabase
                    .rpc('check_admin_access', { attempt: this.adminPassword });

                if (rpcError) throw rpcError;

                if (isValid === true) {
                    // Set session for 2 hours
                    const expiry = Date.now() + (2 * 60 * 60 * 1000);
                    localStorage.setItem('assistec_admin_session', expiry.toString());
                    
                    await this.initAdminView();
                } else {
                    this.loginError = true;
                }
            } catch (error) { 
                console.error(error);
                alert("Erro ao tentar login: " + error.message); 
            } finally { 
                this.loading = false; 
            }
        },
        async initAdminView() {
            try {
                const { data, error } = await supabase.from('responses').select('*');
                if (error) throw error;
                
                this.dbSubmissions = data; 
                
                await this.fetchCalendarConfig();
                this.currentView = 'dashboard';
                setTimeout(() => this.renderChart(), 200);
            } catch (e) {
                console.error("Erro carregando dados admin:", e);
            }
        },

        async fetchCalendarConfig() {
            try {
                const { data, error } = await supabase
                    .from('calendar_config')
                    .select('data')
                    .eq('id', 1)
                    .single();
                
                if (error && error.code !== 'PGRST116') throw error; 
                
                if (data && data.data) {
                    this.campusDates = data.data;
                }
                
                this.syncDates();
            } catch (error) {
                console.error("Erro ao carregar datas:", error.message);
            }
        },
        renderChart() {
            const ctx = document.getElementById('resultsChart'); if (!ctx) return;
            const labels = this.consolidatedData.map(d => d.ictName.split('-')[0]);
            const dataValues = this.consolidatedData.map(d => d.uniqueCampiCount);
            if (this.chartInstance) this.chartInstance.destroy();
            this.chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{ label: 'Campi', data: dataValues, backgroundColor: '#4f46e5', borderRadius: 6 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } }
            });
        },
        
        async saveCampusDates() {
            this.savingDates = true;
            try {
                const { error } = await supabase
                    .from('calendar_config')
                    .upsert({ 
                        id: 1, 
                        data: this.campusDates,
                        updated_at: new Date()
                    });

                if (error) throw error;
                
                const btn = document.activeElement;
                if(btn) {
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Salvo!';
                    setTimeout(() => { btn.innerHTML = originalText; }, 2000);
                }
                
            } catch (error) {
                alert('Erro ao salvar: ' + error.message);
            } finally {
                this.savingDates = false;
            }
        },
        calculateDayStats(dateStr) {
            let totalCampi = this.uniqueCampiFlatList.length;
            if (totalCampi === 0) return { heatClass: 'bg-slate-50 text-slate-400', available: [], recess: [], vacation: [] };

            let recessCount = 0;
            let vacationCount = 0;
            let availableList = [];
            let recessList = [];
            let vacationList = [];

            this.uniqueCampiFlatList.forEach(campus => {
                const dates = this.campusDates[campus.id];
                if (!dates) {
                    availableList.push(campus.fullLabel);
                    return;
                }

                const isRecess = dates.recessStart && dates.recessEnd && dateStr >= dates.recessStart && dateStr <= dates.recessEnd;
                const isVacation = dates.vacStart && dates.vacEnd && dateStr >= dates.vacStart && dateStr <= dates.vacEnd;

                if (isVacation) {
                    vacationCount++;
                    vacationList.push(campus.fullLabel);
                } else if (isRecess) {
                    recessCount++;
                    recessList.push(campus.fullLabel);
                } else {
                    availableList.push(campus.fullLabel);
                }
            });

            const absentCount = recessCount + vacationCount;
            const ratio = totalCampi > 0 ? absentCount / totalCampi : 0;

            let heatClass = 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'; 
            if (ratio > 0.1) heatClass = 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'; 
            if (ratio > 0.4) heatClass = 'bg-orange-100 text-orange-700 hover:bg-orange-200';
            if (ratio > 0.7) heatClass = 'bg-red-100 text-red-700 hover:bg-red-200 font-bold'; 

            return {
                ratio,
                recessCount,
                vacationCount,
                availableList,
                recessList,
                vacationList,
                heatClass
            };
        },
        openDayDetails(dayObj) {
            if(dayObj.empty) return;
            
            const parts = dayObj.date.split('-'); 
            const dateFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
            
            this.selectedDayDetails = {
                title: dateFmt,
                stats: dayObj.stats
            };
            this.showDayModal = true;
        }
    },
    mounted() {
        this.loadFormDetails();
        this.checkCookies(); 
        this.fetchGlobalConfig(); 
        this.checkSession();
    }
}).mount('#app');
