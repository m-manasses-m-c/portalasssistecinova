/* --- admin.js --- */
const { createApp } = Vue;
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            currentView: 'login', // 'login' ou 'dashboard'
            adminPassword: '',
            loginError: false,
            loading: false,

            adminTab: 'charts', // charts, calendar, access, config
            
            // Dados Globais
            dbSubmissions: [],
            dbPortals: [], // <-- NOVO: Armazena os dados da tabela ict_portals
            globalSchedules: {},
            allIcts: [],
            allCampi: [],

            // Charts
            chartInstance: null,

            // Config / Importação
            importText: '',
            importMessage: '',
            importError: false,

            // Edição Admin
            showAdminEditModal: false,
            adminEditingIct: null,
            editSchedules: {}, // Buffer de edição temporária

            // UI State
            expandedIcts: [],

            // --- NOVO: Estado do Calendário ---
            eventList: [],
            calendarYear: new Date().getFullYear(), // <-- Inicia com o ano atual
            calendarMonths: [],
            calendarFilterIct: '',
            showDayModal: false,
            selectedDay: null,
            showEventModal: false,
            eventForm: {},
            editingEventIndex: null,
            categoryColors: {
                'Recesso': '#f97316', 'Férias': '#3b82f6', 'Feriado': '#8b5cf6', 
                'Greve': '#ef4444', 'Outro': '#64748b'
            },
            saving: false, // <-- Adicionado para feedback do botão salvar
            showFullCalendar: false, // <-- Controla a visibilidade
            wizardForm: { // <-- Dados para o novo wizard
                title: '',
                start: '',
                end: '',
                category: 'Feriado',
                scope: 'global',
                targetIcts: [],
                targetCampi: [],
                searchIct: '',
                searchCampus: ''
            }
        }
    },
    watch: {
        // --- NOVO: Recalcula o calendário quando o filtro ou o ANO muda ---
        calendarFilterIct() {
            this.processCalendar();
        },
        calendarYear() {
            this.processCalendar();
        }
    },
    computed: {
        // Mapeia portais existentes por nome da ICT para fácil acesso
        portalsByIctName() {
            const map = {};
            this.dbPortals.forEach(p => {
                map[p.ict_name] = p;
            });
            return map;
        },

        // Estatísticas para os cards (sem alteração na lógica)
        consolidatedData() {
            const ictMap = new Map();
            this.dbSubmissions.forEach(sub => {
                if (!sub.ict) return;

                if (!ictMap.has(sub.ict)) {
                    ictMap.set(sub.ict, {
                        ictName: sub.ict,
                        respondents: new Set(),
                        uniqueCampiNames: new Set(),
                    });
                }
                
                const ictData = ictMap.get(sub.ict);
                ictData.respondents.add(sub.email);

                if (sub.campi && Array.isArray(sub.campi)) {
                    sub.campi.forEach(c => ictData.uniqueCampiNames.add(c.name));
                }
            });
            
            const result = Array.from(ictMap.values());
            result.forEach(item => {
                item.uniqueCampiCount = item.uniqueCampiNames.size;
            });

            return result.sort((a, b) => b.uniqueCampiCount - a.uniqueCampiCount);
        },
        totalCampiCount() {
            return this.consolidatedData.reduce((acc, curr) => acc + curr.uniqueCampiCount, 0);
        },

        // --- NOVO: Computadas do Calendário ---
        allCampiFromResponses() {
            const all = [];
            const seen = new Set();
            this.dbSubmissions.forEach(sub => {
                if (sub.campi) {
                    sub.campi.forEach(c => {
                        if (!seen.has(c.id)) {
                            all.push({ ...c, ict: sub.ict });
                            seen.add(c.id);
                        }
                    });
                }
            });
            return all;
        },

        // --- Computadas para o Wizard ---
        filteredWizardIcts() {
            if (!this.wizardForm.searchIct) return [];
            const search = this.wizardForm.searchIct.toLowerCase();
            return this.consolidatedData.filter(ict => 
                ict.ictName.toLowerCase().includes(search) &&
                !this.wizardForm.targetIcts.includes(ict.ictName)
            );
        },
        filteredWizardCampi() {
            if (!this.wizardForm.searchCampus) return [];
            const search = this.wizardForm.searchCampus.toLowerCase();
            return this.allCampiFromResponses.filter(campus =>
                campus.name.toLowerCase().includes(search) &&
                !this.wizardForm.targetCampi.find(c => c.id === campus.id)
            );
        }
    },
    methods: {
        isIctExpanded(ictName) {
            return this.expandedIcts.includes(ictName);
        },
        toggleIctExpansion(ictName) {
            const index = this.expandedIcts.indexOf(ictName);
            if (index > -1) {
                this.expandedIcts.splice(index, 1);
            } else {
                this.expandedIcts.push(ictName);
            }
        },
        formatDateBR(val) { return window.formatDateBR(val); },

        // --- Autenticação e Carregamento de Dados (Refatorado para RPC) ---
        async checkLogin() {
            this.loading = true;
            this.loginError = false;
            try {
                // Chama a função RPC segura para obter todos os dados
                const { data, error } = await supabase.rpc('get_admin_dashboard_data', {
                    admin_password: this.adminPassword
                });

                if (error) throw error;

                // Popula os dados locais com a resposta da função
                this.dbSubmissions = data.responses || [];
                this.dbPortals = data.portals || [];
                this.eventList = (data.calendar && data.calendar.events) ? data.calendar.events : [];
                if (data.app_config) {
                    this.allIcts = data.app_config.icts || [];
                    this.allCampi = data.app_config.campi || [];
                }
                
                // Salva a sessão
                const expiry = Date.now() + (2 * 60 * 60 * 1000);
                localStorage.setItem('assistec_admin_session_pwd', this.adminPassword); // Salva a senha para re-autenticar
                localStorage.setItem('assistec_admin_session_exp', expiry.toString());
                
                this.currentView = 'dashboard';
                this.renderChart();
                this.processCalendar(); // <-- NOVO: Inicia o calendário

            } catch (e) {
                console.error(e);
                this.loginError = true;
                alert("Acesso Negado: " + e.message);
            } finally {
                this.loading = false;
            }
        },
        logout() {
            localStorage.removeItem('assistec_admin_session_pwd');
            localStorage.removeItem('assistec_admin_session_exp');
            this.currentView = 'login';
            this.adminPassword = '';
            this.dbSubmissions = [];
            this.dbPortals = [];
        },
        async checkSession() {
            const expiry = localStorage.getItem('assistec_admin_session_exp');
            const pwd = localStorage.getItem('assistec_admin_session_pwd');
            if (expiry && Date.now() < parseInt(expiry) && pwd) {
                this.adminPassword = pwd;
                await this.checkLogin(); // Re-autentica para carregar os dados
            }
        },

        // --- Gestão de Acessos (Refatorado para RPC) ---
        async createOrUpdatePortal(submission) {
            if (!submission || !submission.ict) return;
            
            const confirmationText = this.portalsByIctName[submission.ict]
                ? `Isso irá REGERAR a chave de acesso para ${submission.ict}. O link antigo deixará de funcionar. Deseja continuar?`
                : `Isso criará um novo portal de acesso para ${submission.ict} usando os dados deste formulário. Deseja continuar?`;

            if (!confirm(confirmationText)) return;

            try {
                const { data: newPortalData, error } = await supabase.rpc('admin_create_or_update_portal', {
                    admin_password: this.adminPassword,
                    p_ict_name: submission.ict,
                    p_contact_name: submission.name,
                    p_contact_email: submission.email,
                    p_source_response_id: submission.id
                });

                if (error) throw error;

                // Atualiza a lista local de portais
                const index = this.dbPortals.findIndex(p => p.ict_name === newPortalData.ict_name);
                if (index !== -1) {
                    this.dbPortals[index] = newPortalData;
                } else {
                    this.dbPortals.push(newPortalData);
                }
                alert(`Portal para ${newPortalData.ict_name} foi criado/atualizado com sucesso! Nova chave: ${newPortalData.access_key}`);

            } catch (e) {
                alert("Erro ao gerenciar portal: " + e.message);
            }
        },
        copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => alert(`Chave ${text} copiada!`));
        },

        // --- Edição de Cronograma (Admin Mode) ---
        openEditModal(submission) {
            this.adminEditingIct = JSON.parse(JSON.stringify(submission)); // Clone
            this.editSchedules = {};
            
            // Popula com dados globais ou vazios
            this.adminEditingIct.campi.forEach(c => {
                if (this.globalSchedules[c.id]) {
                    this.editSchedules[c.id] = { ...this.globalSchedules[c.id] };
                } else {
                    this.editSchedules[c.id] = { recessStart: '', recessEnd: '', vacStart: '', vacEnd: '' };
                }
            });
            this.showAdminEditModal = true;
        },
        async saveAdminEdits() {
            if (!confirm("Confirmar alterações? Isso atualizará o painel do parceiro.")) return;
            
            this.loading = true;
            try {
                const upserts = [];
                this.adminEditingIct.campi.forEach(campus => {
                    const sched = this.editSchedules[campus.id];
                    upserts.push({
                        response_id: this.adminEditingIct.id,
                        campus_id: campus.id,
                        recess_start: sched.recessStart || null,
                        recess_end: sched.recessEnd || null,
                        vac_start: sched.vacStart || null,
                        vac_end: sched.vacEnd || null,
                        updated_at: new Date(),
                        last_editor: 'ADMIN'
                    });
                });

                // ATENÇÃO: Esta chamada direta precisa ser convertida para RPC se o RLS bloquear
                const { error } = await supabase
                    .from('campus_schedules')
                    .upsert(upserts, { onConflict: 'response_id, campus_id' });

                if (error) throw error;

                // await this.fetchSchedules(); // Precisa recarregar os dados via RPC
                alert("Salvo com sucesso!");
                this.showAdminEditModal = false;

            } catch (e) {
                alert("Erro: " + e.message);
            } finally {
                this.loading = false;
            }
        },

        // --- NOVO: Lógica de Importação de Configs ---
        async processImport() {
            this.importMessage = '';
            this.importError = false;

            if (!this.importText.trim()) {
                this.importError = true;
                this.importMessage = "A caixa de texto está vazia.";
                return;
            }

            try {
                const lines = this.importText.trim().split('\n');
                const campi = [];
                const ictMap = new Map();
                let campusId = 1;

                lines.forEach(line => {
                    const [sigla, nomeCompleto, campusNome] = line.split('	'); // Separado por Tab
                    if (sigla && nomeCompleto && campusNome) {
                        const ictName = `${sigla.trim()} - ${nomeCompleto.trim()}`;
                        if (!ictMap.has(ictName)) {
                            ictMap.set(ictName, { name: ictName });
                        }
                        campi.push({
                            id: campusId++,
                            name: campusNome.trim(),
                            ictName: ictName
                        });
                    }
                });

                const icts = Array.from(ictMap.values());

                if (icts.length === 0 || campi.length === 0) {
                    this.importError = true;
                    this.importMessage = "Nenhum dado válido encontrado. Verifique o formato (SIGLA | NOME | CAMPUS) separado por tabulação.";
                    return;
                }

                if (!confirm(`Você está prestes a substituir a base de dados com ${icts.length} ICTs e ${campi.length} campi. Deseja continuar?`)) {
                    return;
                }

                const { data, error } = await supabase.rpc('admin_update_app_config', {
                    admin_password: this.adminPassword,
                    new_icts: icts,
                    new_campi: campi
                });

                if (error) throw error;

                this.importError = false;
                this.importMessage = `${data} Foram importados ${icts.length} ICTs e ${campi.length} campi.`;
                this.importText = '';

                // Recarrega todos os dados do dashboard para refletir a mudança
                await this.checkLogin();

            } catch (e) {
                this.importError = true;
                this.importMessage = "Erro ao processar a importação: " + e.message;
            }
        },

        // --- Charts & Export ---
        renderChart() {
            this.$nextTick(() => {
                const ctx = document.getElementById('resultsChart');
                if (!ctx) return;
                if (this.chartInstance) this.chartInstance.destroy();
    
                const labels = this.consolidatedData.map(d => d.ictName.split(' - ')[0]);
                const dataVal = this.consolidatedData.map(d => d.uniqueCampiCount);
    
                this.chartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Campi Aderentes',
                            data: dataVal,
                            backgroundColor: 'rgba(79, 70, 229, 0.8)',
                            borderColor: 'rgba(79, 70, 229, 1)',
                            borderWidth: 1,
                            borderRadius: 8,
                            barThickness: 30,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: '#fff',
                                titleColor: '#334155',
                                bodyColor: '#64748b',
                                borderColor: '#e2e8f0',
                                borderWidth: 1,
                                padding: 10,
                                cornerRadius: 8,
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: {
                                    color: '#f1f5f9',
                                },
                                ticks: {
                                    color: '#64748b',
                                }
                            },
                            x: {
                                grid: {
                                    display: false,
                                },
                                ticks: {
                                    color: '#64748b',
                                }
                            }
                        }
                    }
                });
            });
        },
        exportToExcel() {
            if (this.dbSubmissions.length === 0) return alert("Sem dados.");
            
            const rows = [];
            this.dbSubmissions.forEach(sub => {
                if (sub.campi && sub.campi.length) {
                    sub.campi.forEach(c => {
                        const sched = this.globalSchedules[c.id] || {};
                        rows.push({
                            "ID": sub.id,
                            "ICT": sub.ict,
                            "Campus": c.name,
                            "Responsável": sub.name,
                            "Email": sub.email,
                            "Chave": sub.access_key || '',
                            "Recesso Início": this.formatDateBR(sched.recessStart),
                            "Recesso Fim": this.formatDateBR(sched.recessEnd),
                            "Férias Início": this.formatDateBR(sched.vacStart),
                            "Férias Fim": this.formatDateBR(sched.vacEnd)
                        });
                    });
                }
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Adesao_Completa");
            XLSX.writeFile(wb, `Relatorio_Assistec_${new Date().toISOString().slice(0,10)}.xlsx`);
        },

        // --- Configuração / Importação ---
        async processImport() {
             if (!this.importText.trim()) { this.importError = true; this.importMessage = "Vazio."; return; }
             // (Mesma lógica de importação do código original, adaptada se necessário)
             // ...
             this.importMessage = "Funcionalidade de importação mantida (simplificada aqui).";
        },

        // --- NOVO: Métodos do Calendário ---
        generateCalendar(year, monthCount) {
            const months = [];
            let currentDate = new Date(year, 0, 1); // Começa em 1 de Janeiro

            for (let i = 0; i < monthCount; i++) {
                const monthName = currentDate.toLocaleString('pt-BR', { month: 'long' });
                const yearNum = currentDate.getFullYear();
                const monthDays = [];
                const daysInMonth = new Date(year, currentDate.getMonth() + 1, 0).getDate();
                const firstDayOfWeek = new Date(year, currentDate.getMonth(), 1).getDay();

                // Preenche dias vazios no início
                for (let j = 0; j < firstDayOfWeek; j++) {
                    monthDays.push({ empty: true });
                }

                // Preenche os dias do mês
                for (let day = 1; day <= daysInMonth; day++) {
                    monthDays.push({
                        day: day,
                        date: new Date(year, currentDate.getMonth(), day),
                        dateFmt: `${day}/${currentDate.getMonth() + 1}/${year}`,
                        stats: { total: 0, unavailableCount: 0, ratio: 0, heatClass: '' },
                        unavailableIcts: []
                    });
                }
                months.push({ name: `${monthName}`, days: monthDays }); // Removido o ano do nome do mês
                currentDate.setMonth(currentDate.getMonth() + 1);
            }
            this.calendarMonths = months;
        },

        processCalendar() {
            this.generateCalendar(this.calendarYear, 12); // <-- Gera 12 meses para o ano selecionado

            const ictsToProcess = this.calendarFilterIct 
                ? this.consolidatedData.filter(ict => ict.ictName === this.calendarFilterIct)
                : this.consolidatedData;

            const totalIcts = ictsToProcess.length;
            if (totalIcts === 0) return;

            this.calendarMonths.forEach(month => {
                month.days.forEach(day => {
                    if (day.empty) return;

                    day.stats = { total: totalIcts, unavailableCount: 0, ratio: 0, heatClass: '' };
                    day.unavailableIcts = [];
                    const dayStart = day.date.setHours(0, 0, 0, 0);

                    ictsToProcess.forEach(ict => {
                        let isUnavailable = false;
                        let reason = '';

                        for (const event of this.eventList) {
                            const eventStart = new Date(event.start).getTime();
                            const eventEnd = new Date(event.end).getTime();

                            if (dayStart >= eventStart && dayStart <= eventEnd) {
                                const scopeMatch = event.scope === 'global' ||
                                    (event.scope === 'ict' && event.targetIds.includes(ict.ictName)) ||
                                    (event.scope === 'campus' && this.doesEventAffectIct(event, ict.ictName));

                                if (scopeMatch) {
                                    isUnavailable = true;
                                    reason = event.title;
                                    break; 
                                }
                            }
                        }

                        if (isUnavailable) {
                            day.unavailableIcts.push({ name: ict.ictName, reason });
                        }
                    });

                    day.stats.unavailableCount = day.unavailableIcts.length;
                    day.stats.ratio = totalIcts > 0 ? day.stats.unavailableCount / totalIcts : 0;
                    day.stats.heatClass = this.getHeatClass(day.stats.ratio);
                });
            });
        },

        doesEventAffectIct(event, ictName) {
            const campiOfIct = this.allCampiFromResponses
                .filter(c => c.ict === ictName)
                .map(c => c.id.toString());
            
            return event.targetIds.some(targetId => campiOfIct.includes(targetId));
        },

        getHeatClass(ratio) {
            if (ratio >= 0.8) return 'bg-red-100 border-red-200';
            if (ratio >= 0.4) return 'bg-orange-100 border-orange-200';
            if (ratio >= 0.1) return 'bg-yellow-100 border-yellow-200';
            return 'bg-emerald-100 border-emerald-200';
        },

        openDayDetails(day) {
            if (day.empty) return;
            this.selectedDay = day;
            this.showDayModal = true;
        },

        // --- Métodos do Wizard de Eventos (Admin) ---
        openEventModal(event = null, index = null) {
            this.editingEventIndex = index;
            if (event) {
                this.eventForm = JSON.parse(JSON.stringify(event));
            } else {
                this.eventForm = {
                    title: '', category: 'Feriado', start: '', end: '',
                    scope: 'global', targetIds: [], color: this.categoryColors['Feriado']
                };
            }
            this.showEventModal = true;
        },
        closeEventModal() {
            this.showEventModal = false;
            this.eventForm = {};
            this.editingEventIndex = null;
        },
        submitEvent() {
            if (!this.eventForm.title || !this.eventForm.start || !this.eventForm.end || !this.eventForm.category) {
                alert("Preencha todos os campos básicos (Título, Categoria, Início, Fim).");
                return;
            }
            if (this.eventForm.scope === 'global') {
                this.eventForm.targetIds = [];
            }
            this.eventForm.color = this.categoryColors[this.eventForm.category] || this.categoryColors['Outro'];

            if (this.editingEventIndex !== null) {
                this.eventList.splice(this.editingEventIndex, 1, this.eventForm);
            } else {
                this.eventList.push(this.eventForm);
            }
            this.processCalendar();
            this.closeEventModal();
        },
        removeEvent(index) {
            if (confirm(`Tem certeza que deseja remover o evento "${this.eventList[index].title}"?`)) {
                this.eventList.splice(index, 1);
                this.processCalendar();
            }
        },
        async saveEvents() {
            if (!confirm("Isso irá substituir TODOS os eventos no calendário com a lista atual. Deseja continuar?")) return;
            this.saving = true;
            try {
                const { data, error } = await supabase.rpc('admin_update_calendar_events', {
                    admin_password: this.adminPassword,
                    all_events: this.eventList
                });
                if (error) throw error;
                alert(data);
            } catch (e) {
                alert("Erro ao salvar eventos: " + e.message);
            } finally {
                this.saving = false;
            }
        },

        // --- Métodos para o Novo Wizard ---
        addEventFromWizard() {
            const { title, start, end, category, targetIcts, targetCampi } = this.wizardForm;
            if (!title || !start || !end) {
                alert("Preencha Título, Início e Fim.");
                return;
            }

            let scope = 'global';
            let targetIds = [];

            if (targetCampi.length > 0) {
                scope = 'campus';
                targetIds = targetCampi.map(c => c.id.toString());
            } else if (targetIcts.length > 0) {
                scope = 'ict';
                targetIds = targetIcts;
            }

            const newEvent = {
                title, start, end, category, scope, targetIds,
                color: this.categoryColors[category] || this.categoryColors['Outro']
            };

            this.eventList.push(newEvent);
            this.processCalendar();
            this.resetWizard();
            alert("Evento adicionado com sucesso!");
        },

        resetWizard() {
            this.wizardForm = {
                title: '', start: '', end: '', category: 'Feriado', scope: 'global',
                targetIcts: [], targetCampi: [], searchIct: '', searchCampus: ''
            };
        },

        // --- UI Helpers ---
        getScopeIcon(scope) {
            const icons = { 'global': 'fa-globe', 'ict': 'fa-building-columns', 'campus': 'fa-school' };
            return icons[scope] || 'fa-question-circle';
        },
        getScopeLabel(evt) {
            if (evt.scope === 'global') return 'Global';
            if (evt.scope === 'ict') return `${evt.targetIds.length} ICT(s)`;
            if (evt.scope === 'campus') return `${evt.targetIds.length} Campi`;
            return 'N/D';
        },
        formatDate(dateString) {
            if (!dateString) return '';
            const [year, month, day] = dateString.split('-');
            return `${day}/${month}/${year}`;
        },

        // --- (Restante dos métodos como createOrUpdatePortal, etc.) ---
    }
}).mount('#adminApp');
