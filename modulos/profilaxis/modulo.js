/* Módulo: Profilaxis antibiótica perioperatoria (UVEH UPAEP)
   Se carga desde el cascarón (index.html) después de insertar modulo.html.
   Todo el código vive dentro de esta función para no chocar con otros módulos;
   solo se exponen en UVEH.m.profilaxis las funciones que usan los atributos onclick/onchange/oninput. */
(function () {
        // ===== BASE ÚNICA DE CONOCIMIENTO (kb.json) =====
        let KB = null;
        let catalogData = [];
        let pkTableData = [];
        let referencesData = window.referencesData = [];

        async function loadKB() {
            const r = await fetch('modulos/profilaxis/kb.json', { cache: 'no-cache' });
            if (!r.ok) throw new Error('kb.json del módulo no disponible');
            KB = await r.json();
            KB.reglas = KB.reglas || {};
            catalogData = KB.procedimientos || [];
            pkTableData = KB.farmacos || [];
            referencesData = window.referencesData = KB.referencias || [];
        }

        // Regla con valor de respaldo si falta en kb.json
        function regla(nombre, respaldo) {
            const v = KB && KB.reglas ? KB.reglas[nombre] : undefined;
            return v === undefined || v === null ? respaldo : v;
        }
        function intervaloRecarga(drug) {
            const mapa = regla('recarga_h', {});
            const clave = Object.keys(mapa).find(k => drug.includes(k));
            return clave !== undefined ? mapa[clave] : 0;
        }

        const specialtyMapping = {
            'cardiovascular': 'Cardiovascular', 'vascular': 'Vascular', 'digestivo': 'Digestivo',
            'hepatobiliar': 'Hepatobiliar', 'colorrectal': 'Colorrectal', 'urologia': 'Urología',
            'ginecologia': 'Ginecología', 'neurocirugia': 'Neurocirugía', 'ortopedia': 'Ortopedia',
            'cabezacuello': 'Cabeza y Cuello', 'plastica': 'Plástica', 'radiologia': 'Radiología',
            'pediatria': 'Pediátrica', 'orl': 'Otorrinolaringología', 'maxilofacial': 'Maxilofacial y Dental',
            'oftalmologia': 'Oftalmología', 'mama': 'Mama y Endocrino', 'nefrologia': 'Nefrología (accesos)'
        };
        const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

        function updateProcedureOptions() {
            const specVal = document.getElementById('calc-specialty').value;
            const mappedSpec = specialtyMapping[specVal] || specVal;
            const procSelect = document.getElementById('calc-procedure');
            if (!procSelect) return;

            procSelect.innerHTML = '';
            const filtered = catalogData.filter(item => item.spec.toLowerCase() === mappedSpec.toLowerCase());
            const listToUse = filtered.length > 0 ? filtered : catalogData;
            listToUse.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.name;
                procSelect.appendChild(opt);
            });
            calculateCDSS();
        }

        // Valor del selector de especialidad que corresponde al nombre de especialidad de un procedimiento
        function valorEspecialidad(nombreSpec) {
            const e = Object.entries(specialtyMapping).find(([, n]) => n === nombreSpec);
            return e ? e[0] : null;
        }

        // Mientras hay una búsqueda activa, el selector de especialidad sigue al procedimiento elegido
        function syncEspecialidadConProcedimiento() {
            const q = norm(document.getElementById('calc-proc-search')?.value).trim();
            if (q.length < 2) return;
            const sel = document.getElementById('calc-specialty');
            const proc = document.getElementById('calc-procedure');
            const item = catalogData.find(p => p.id === proc?.value);
            const v = item ? valorEspecialidad(item.spec) : null;
            if (sel && v) sel.value = v; // asignar el valor por código no dispara el evento "change"
        }

        function searchProcedureOptions() {
            const q = norm(document.getElementById('calc-proc-search')?.value).trim();
            const procSelect = document.getElementById('calc-procedure');
            if (!procSelect) return;
            if (q.length < 2) { updateProcedureOptions(); return; }
            const palabras = q.split(/\s+/);
            const hallados = catalogData.filter(it => {
                const t = norm(`${it.name} ${it.spec} ${it.path} ${it.first} ${it.alias || ''}`);
                return palabras.every(p => t.includes(p));
            });
            procSelect.innerHTML = '';
            if (!hallados.length) {
                const opt = document.createElement('option');
                opt.value = ''; opt.disabled = true; opt.selected = true;
                opt.textContent = 'Sin resultados: pruebe otra palabra o elija la especialidad';
                procSelect.appendChild(opt);
                return;
            }
            hallados.forEach(it => {
                const opt = document.createElement('option');
                opt.value = it.id;
                opt.textContent = `${it.name} (${it.spec})`;
                procSelect.appendChild(opt);
            });
            syncEspecialidadConProcedimiento();
            calculateCDSS();
        }

        function calculateBMI() {
            const weight = parseFloat(document.getElementById('calc-weight')?.value) || 70;
            const height = parseFloat(document.getElementById('calc-height')?.value) || 170;
            const bmiValEl = document.getElementById('calc-bmi-val');
            const bmiCatEl = document.getElementById('calc-bmi-cat');
            if (!bmiValEl || !bmiCatEl) return;

            const bmi = weight / ((height / 100) * (height / 100));
            bmiValEl.textContent = bmi.toFixed(1);

            const set = (txt, color) => { bmiCatEl.textContent = txt; bmiCatEl.className = `px-2 py-0.5 rounded text-white ${color} text-[10px]`; };
            if (bmi < 18.5) set('Bajo peso', 'bg-amber-500');
            else if (bmi < 25) set('Normal', 'bg-emerald-600');
            else if (bmi < 30) set('Sobrepeso', 'bg-amber-600');
            else if (bmi < 35) set('Obesidad I', 'bg-rose-500');
            else if (bmi < 40) set('Obesidad II', 'bg-rose-600');
            else set('Obesidad III (Mórbida)', 'bg-rose-700');
        }

        // Marcación automática de "Paciente Obstétrica en Gestación" según el procedimiento elegido
        let ultimoProcId = null;
        let obstetricaAuto = false;

        function obstetricaManual() { obstetricaAuto = false; }

        function mostrarNotaObstetrica(visible) {
            let nota = document.getElementById('obst-auto-note');
            const caja = document.getElementById('calc-obstetric');
            if (!nota && caja) {
                nota = document.createElement('span');
                nota.id = 'obst-auto-note';
                nota.className = 'ml-6 block text-[11px] text-purple-700';
                nota.textContent = 'Marcado automáticamente por el procedimiento obstétrico elegido. Puede desmarcarlo.';
                const contenedor = caja.closest('label') || caja.parentElement;
                contenedor.insertAdjacentElement('afterend', nota);
            }
            if (nota) nota.classList.toggle('hidden', !visible);
        }

        function aplicarObstetricaAutomatica(procObj) {
            if (!procObj || procObj.id === ultimoProcId) return; // solo cuando cambia el procedimiento
            ultimoProcId = procObj.id;
            const caja = document.getElementById('calc-obstetric');
            if (!caja) return;
            if (procObj.obstetrico === true) {
                caja.checked = true;
                obstetricaAuto = true;
                mostrarNotaObstetrica(true);
            } else if (obstetricaAuto) {
                caja.checked = false; // se había marcado sola: se desmarca al salir de lo obstétrico
                obstetricaAuto = false;
                mostrarNotaObstetrica(false);
            }
        }

        function calculateCDSS() {
            if (!KB) return;
            const procSelect = document.getElementById('calc-procedure');
            if (!procSelect) return;
            const procObj = catalogData.find(p => p.id === procSelect.value) || catalogData[0];
            if (!procObj) return;
            aplicarObstetricaAutomatica(procObj);

            const weight = parseFloat(document.getElementById('calc-weight')?.value) || 70;
            const height = parseFloat(document.getElementById('calc-height')?.value) || 170;
            const age = Math.min(Math.max(parseFloat(document.getElementById('calc-age')?.value) || 45, 0), 120);
            const bmi = weight / ((height / 100) * (height / 100));
            const isObstetric = document.getElementById('calc-obstetric')?.checked;
            const allergy = document.getElementById('calc-allergy')?.value;
            const hasMRSA = document.getElementById('calc-mrsa')?.checked;
            const duration = parseFloat(document.getElementById('calc-duration')?.value) || 2;
            const bloodLoss = parseFloat(document.getElementById('calc-bloodloss')?.value) || 0;
            const hasProsthesis = document.getElementById('calc-prosthesis')?.value === 'si';

            const pesoAjuste = regla('peso_ajuste_kg', 120);
            const dosisAlto = regla('dosis_alto_peso_g', 3);
            const sangradoMl = regla('sangrado_recarga_ml', 1500);
            const sangradoMlKg = regla('sangrado_recarga_ml_kg_pediatria', 25);
            const ventana = regla('ventana_min', { beta_lactamico: 60, vancomicina: 120 });
            const recargaCef = regla('recarga_h', {}).Cefalotina || 4;

            const alertsContainer = document.getElementById('result-alerts-container');
            if (alertsContainer) alertsContainer.innerHTML = '';

            const estado = procObj.status;
            const fijo = procObj.fijo === true;
            const sinProfilaxis = estado === 'exento' && !hasProsthesis;
            const sinDato = estado === 'sin_dato';
            const terapeutico = estado === 'terapeutico';
            const noAplica = sinProfilaxis || sinDato || terapeutico;
            const fuente = procObj.src ? ` Fuente: ${procObj.src}.` : '';

            const setClase = (txt, cls) => {
                const el = document.getElementById('result-wound-class');
                el.textContent = txt; el.className = cls;
            };
            if (sinProfilaxis) {
                document.getElementById('status-icon').textContent = '⚠️';
                document.getElementById('result-status-title').textContent = 'Profilaxis NO Recomendada de Rutina';
                setClase(`${procObj.class} · sin profilaxis`, 'px-3 py-1 rounded-full text-xs font-bold bg-slate-200 text-slate-700');
            } else if (sinDato) {
                document.getElementById('status-icon').textContent = '❔';
                document.getElementById('result-status-title').textContent = 'Sin recomendación específica en la base';
                setClase(procObj.class, 'px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300');
            } else if (terapeutico) {
                document.getElementById('status-icon').textContent = '🩺';
                document.getElementById('result-status-title').textContent = 'Requiere tratamiento antibiótico, no solo profilaxis';
                setClase(procObj.class, 'px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300');
            } else {
                document.getElementById('status-icon').textContent = '✅';
                document.getElementById('result-status-title').textContent = 'Profilaxis Antimicrobiana Indicada (UVEH UPAEP)';
                setClase(hasProsthesis ? `${procObj.class} (Con Implante)` : procObj.class, 'px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-900 border border-purple-300');
            }

            let primaryDrugText = procObj.first;
            let altText = procObj.alt;
            let durText = procObj.dur;
            // Cirugía limpia "exenta" pero con prótesis/implante: ASHP 2013 sí indica profilaxis
            if (estado === 'exento' && hasProsthesis) {
                primaryDrugText = 'Cefalotina 2 g IV';
                altText = 'Vancomicina 1 g IV (1.5 g si pesa > 90 kg) o Clindamicina 900 mg IV';
                durText = 'Dosis única preoperatoria (< 24 h)';
            }
            let doseNote;
            if (sinProfilaxis) doseNote = `No se recomienda profilaxis en este procedimiento.${fuente}`;
            else if (sinDato) doseNote = 'La base no contiene una recomendación para este procedimiento. Consulte al Comité de Infecciones.';
            else if (terapeutico) doseNote = `No se trata de profilaxis: la indicación es terapéutica.${fuente}`;
            else doseNote = `Dosis estándar según el esquema institucional UVEH.${fuente}`;
            let timingText = noAplica ? 'No aplica' : (procObj.ventana || `0 a ${ventana.beta_lactamico} minutos previos a la incisión`);

            const ajustable = !noAplica && !fijo && procObj.ajuste_peso !== false;

            if (ajustable && weight >= pesoAjuste && primaryDrugText.includes('Cefalotina') && age >= 18) {
                primaryDrugText = primaryDrugText.replace(/\b(1-)?[123](\.\d)? g( IV)?/, `${dosisAlto} g IV (Ajuste por peso ≥ ${pesoAjuste} kg)`);
                primaryDrugText = primaryDrugText.replace(/\s*\(3 g si (peso )?≥ ?120 kg\)/, '');
                doseNote = `Pacientes con peso ≥ ${pesoAjuste} kg requieren incremento de Cefalotina a ${dosisAlto} g IV.${fuente}`;
                addAlert(`⚖️ Ajuste Posológico por Peso (≥ ${pesoAjuste} kg)`, `Dosis de Cefalotina ajustada a ${dosisAlto} g IV preoperatorio.`, 'purple');
            }

            const imcObst = regla('obstetricia_imc', 35);
            if (!noAplica && !fijo && isObstetric && bmi > imcObst) {
                doseNote += ` 🤰 Gestante con IMC > ${imcObst} kg/m²: considerar dosis doble de profilaxis (HCTM 2018).`;
                addAlert(`🤰 Paciente Obstétrica con IMC > ${imcObst} kg/m²`, 'La guía HCTM 2018 indica duplicar la dosis del antibiótico en mujeres obesas con IMC mayor de 35. Confirmar con el Comité de Infecciones.', 'amber');
            }

            if (ajustable && age < 18 && procObj.first.includes('Cefalotina') && !procObj.first.includes('mg/kg')) {
                const mgkg = regla('peds_cefalotina_mg_kg', 30);
                const mg = Math.min(weight * mgkg, 2000);
                primaryDrugText = `Dosis Pediátrica: Cefalotina ${mgkg} mg/kg IV (Peso: ${weight} kg ≈ ${mg.toFixed(0)} mg IV, máx 2 g)` +
                    (procObj.first.includes('Metronidazol') ? ' + Metronidazol 15 mg/kg IV' : '');
                doseNote = `Calculada a ${mgkg} mg/kg en pediatría. No exceder dosis de adulto.`;
            }

            if (hasMRSA && !noAplica && !fijo) {
                // ASHP 2013 (nota b): la vancomicina se AGREGA al esquema, no lo sustituye
                const vanco = age < 18 ? '15 mg/kg' : (weight > 90 ? '1.5 g' : '15 mg/kg');
                primaryDrugText += ` + Vancomicina ${vanco} IV (dosis única adicional por SARM)`;
                timingText = `Betalactámico: 0 a ${ventana.beta_lactamico} min previos. Vancomicina: iniciar la infusión dentro de los ${ventana.vancomicina} min previos a la incisión`;
                addAlert('🧫 Factor SARM Identificado', 'Se agrega una dosis única de Vancomicina (infusión lenta de 1-2 horas) al esquema recomendado por colonización o riesgo confirmado de SARM.', 'rose');
            } else if (hasMRSA && !noAplica && fijo) {
                addAlert('🧫 Factor SARM Identificado', 'Este procedimiento tiene un esquema fijo en la base. Consulte al Comité de Infecciones si el paciente está colonizado por SARM.', 'rose');
            }

            document.getElementById('result-primary-drug').textContent = primaryDrugText;
            document.getElementById('result-primary-dose-note').textContent = doseNote;
            document.getElementById('result-timing').textContent = timingText;
            document.getElementById('result-alt-drug').textContent = altText;
            document.getElementById('result-alt-timing').textContent = noAplica ? 'No aplica'
                : (fijo ? 'Según el esquema indicado' : `Vancomicina: dentro de ${ventana.vancomicina} min previos; otros: ${ventana.beta_lactamico} min`);

            if (noAplica) {
                // sin profilaxis no se emiten alertas de alergia
            } else if (fijo) {
                if (allergy === 'severe' || allergy === 'mild') {
                    addAlert('Alergia a betalactámicos', 'Revise la alternativa indicada para este procedimiento.', 'amber');
                }
            } else if (allergy === 'severe') {
                addAlert('🔴 Alergia Severa a Betalactámicos (Tipo I IgE)', 'Evitar Penicilinas y Cefalosporinas. Utilizar régimen alternativo: Clindamicina 900 mg IV o Vancomicina 15 mg/kg IV.', 'rose');
            } else if (allergy === 'mild') {
                addAlert('🟢 Alergia Leve No Mediada por IgE', 'Cefalotina o Cefuroxima pueden utilizarse si la reacción no fue inmediata ni grave. La reactividad cruzada penicilina-cefalosporina es baja; la cifra histórica de ~10% sobrestima el riesgo (HCTM 2018).', 'emerald');
            }

            const mapaRec = regla('recarga_h', {});
            const primero = Object.keys(mapaRec)
                .map(k => [k, primaryDrugText.indexOf(k)]).filter(([k, p]) => p >= 0)
                .sort((x, y) => x[1] - y[1])[0];
            const claveRec = (!fijo && primero) ? primero[0] : null;
            const horasRec = claveRec ? mapaRec[claveRec] : 0;
            let redoseMsg;
            if (noAplica) {
                redoseMsg = sinProfilaxis ? 'No aplica (sin profilaxis).' : 'No aplica.';
            } else if (fijo) {
                redoseMsg = 'Esquema fijo: siga la duración indicada para este procedimiento.';
            } else if (claveRec) {
                redoseMsg = `Redosificar ${claveRec} CADA ${horasRec} HORAS desde el inicio de la primera dosis si la cirugía se prolonga.`;
                if (primaryDrugText.includes('Vancomicina')) redoseMsg += ' La vancomicina agregada no requiere refuerzo.';
            } else {
                redoseMsg = 'No requiere dosis de refuerzo durante el acto quirúrgico habitual.';
            }

            if (!noAplica && !fijo && claveRec === 'Cefalotina' && duration >= 2) {
                addAlert('ℹ️ Cefalotina: validar el intervalo de refuerzo', regla('nota_redosificacion_cefalotina', ''), 'amber');
            }

            if (!noAplica && !fijo && horasRec > 0 && duration >= horasRec) {
                addAlert(`⏱️ Cirugía Prolongada (≥ ${horasRec} horas)`, `Duración prevista de ${duration} h. Administrar dosis de recarga intraoperatoria de ${claveRec} a las ${horasRec} horas del inicio de la primera dosis.`, 'purple');
            }

            const hemorragia = age < 18 ? bloodLoss > (sangradoMlKg * weight) : bloodLoss > sangradoMl;
            if (!noAplica && !fijo && hemorragia) {
                addAlert(age < 18 ? `🩸 Pérdida Hemática Mayor (> ${sangradoMlKg} mL/kg)` : `🩸 Pérdida Hemática Mayor (> ${sangradoMl} mL)`, 'Administrar dosis de refuerzo inmediata tras la restitución de volumen plasmático.', 'amber');
            }

            if (procObj.nota) addAlert('ℹ️ Nota de la base', procObj.nota, 'amber');

            document.getElementById('result-redosing-text').textContent = redoseMsg;
            document.getElementById('result-duration-text').textContent = durText;
            document.getElementById('result-pathogens').textContent = procObj.path;
        }

        function addAlert(title, text, color) {
            const container = document.getElementById('result-alerts-container');
            if (!container) return;
            const colorClasses = {
                rose: 'bg-rose-50 border-rose-200 text-rose-900',
                amber: 'bg-amber-50 border-amber-200 text-amber-900',
                purple: 'bg-purple-50 border-purple-200 text-purple-900',
                emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900'
            };
            const div = document.createElement('div');
            div.className = `p-3 rounded-lg border text-xs space-y-0.5 ${colorClasses[color] || colorClasses.purple}`;
            const s = document.createElement('strong'); s.className = 'block'; s.textContent = title;
            const p = document.createElement('p'); p.textContent = text;
            div.append(s, p);
            container.appendChild(div);
        }

        function renderCatalog() {
            const container = document.getElementById('catalog-cards-container');
            if (!container) return;
            container.innerHTML = '';

            const cnt = document.getElementById('catalog-count');
            if (cnt) cnt.textContent = catalogData.length;
            catalogData.forEach(item => {
                const card = document.createElement('div');
                card.className = 'bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-2.5 flex flex-col justify-between hover:border-purple-400 transition';
                card.setAttribute('data-spec', item.spec);
                card.setAttribute('data-text', norm(`${item.name} ${item.first} ${item.path} ${item.spec} ${item.alias || ''}`));
                const isExempt = item.status === 'exento';
                const isAviso = item.status === 'sin_dato' || item.status === 'terapeutico';

                card.innerHTML = `
                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isExempt ? 'bg-slate-100 text-slate-600' : (isAviso ? 'bg-amber-100 text-amber-900' : 'bg-purple-100 text-purple-900')}">${item.spec}</span>
                            <span class="text-[10px] font-semibold text-slate-400">${item.class}</span>
                        </div>
                        <h4 class="font-bold text-slate-900 text-sm leading-snug">${item.name}</h4>
                        <div class="p-2.5 rounded-lg ${isExempt ? 'bg-slate-50 border border-slate-200 text-slate-600' : (isAviso ? 'bg-amber-50 border border-amber-200 text-amber-950' : 'bg-purple-50 border border-purple-200 text-purple-950')} text-xs space-y-1">
                            <span class="font-bold block text-[10px] uppercase tracking-wider text-purple-700">1ª Línea UVEH:</span>
                            <strong>${item.first}</strong>
                        </div>
                        <div class="p-2 rounded bg-slate-50 text-xs text-slate-700">
                            <span class="font-bold text-[10px] uppercase text-slate-400 block">Alternativa Alergia IgE:</span>
                            ${item.alt}
                        </div>
                    </div>
                    <div class="pt-2 border-t text-[11px] text-slate-500 space-y-1">
                        <div><strong>Patógenos:</strong> ${item.path}</div>
                        <div><strong>Duración / Recarga:</strong> ${item.dur}</div>
                        ${item.nota ? `<div class="text-amber-800"><strong>Nota:</strong> ${item.nota}</div>` : ''}
                        ${item.src ? `<div class="text-slate-400"><strong>Fuente:</strong> ${item.src}</div>` : ''}
                    </div>`;
                container.appendChild(card);
            });
        }

        function filterCatalog() {
            const query = norm(document.getElementById('catalog-search')?.value || '').trim();
            const specFilter = document.getElementById('catalog-filter-spec')?.value || 'all';
            document.querySelectorAll('#catalog-cards-container > div').forEach(card => {
                const text = card.getAttribute('data-text') || '';
                const spec = card.getAttribute('data-spec') || '';
                const ok = text.includes(query) && (specFilter === 'all' || spec === specFilter);
                card.classList.toggle('hidden', !ok);
            });
        }

        function renderPKTable() {
            const tbody = document.getElementById('pk-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            pkTableData.forEach(row => {
                const tr = document.createElement('tr');
                const isCeftriaxone = row.drug.includes('Ceftriaxona');
                tr.className = isCeftriaxone ? 'bg-purple-50/50 border-b border-purple-100' : 'hover:bg-slate-50 transition border-b border-slate-100';
                tr.innerHTML = `
                    <td class="p-2.5 font-bold ${isCeftriaxone ? 'text-purple-900' : 'text-slate-900'}">${row.drug}</td>
                    <td class="p-2.5">${row.adult}</td>
                    <td class="p-2.5">${row.peds}</td>
                    <td class="p-2.5 font-semibold text-purple-700">${row.t12}</td>
                    <td class="p-2.5 font-bold ${isCeftriaxone ? 'text-purple-800' : (row.redose.includes('4 horas') ? 'text-purple-900' : 'text-slate-600')}">${row.redose}</td>`;
                tbody.appendChild(tr);
            });
        }

        function runRedoseSimulation() {
            if (!KB) return;
            const drug = document.getElementById('sim-drug')?.value || 'Cefalotina';
            const timeStr = document.getElementById('sim-time')?.value || '08:00';
            if (!timeStr) return;

            const [hours, minutes] = timeStr.split(':').map(Number);
            const intervalHours = intervaloRecarga(drug);
            const outTimeEl = document.getElementById('sim-output-time');
            const outDescEl = document.getElementById('sim-output-desc');

            if (intervalHours > 0) {
                const h = String((hours + intervalHours) % 24).padStart(2, '0');
                const m = String(minutes).padStart(2, '0');
                outTimeEl.textContent = `Primera Dosis de Refuerzo: ${h}:${m} hrs (+${intervalHours}h)`;
                outDescEl.textContent = `${drug}: dosis de refuerzo cada ${intervalHours} horas según la base UVEH.`;
            } else {
                outTimeEl.textContent = 'Dosis de Refuerzo: No requiere durante la cirugía habitual';
                outDescEl.textContent = 'Vida media prolongada: no requiere dosis de refuerzo en cirugía habitual.';
            }
        }

        function renderReferences() {
            const container = document.getElementById('references-cards-container');
            if (!container) return;
            container.innerHTML = '';
            const countEl = document.getElementById('ref-count');
            if (countEl) countEl.textContent = `${referencesData.length} Documentos Incorporados`;

            const catBadges = {
                guia: { name: 'Guía Clínica Oficial', class: 'bg-purple-100 text-purple-900 border-purple-200' },
                stewardship: { name: 'Optimización / Stewardship (AMS)', class: 'bg-emerald-100 text-emerald-900 border-emerald-200' },
                epidemiologia: { name: 'Epidemiología y RAM (México)', class: 'bg-rose-100 text-rose-900 border-rose-200' },
                manual: { name: 'Manual de Referencia', class: 'bg-amber-100 text-amber-900 border-amber-200' },
                equivalencia: { name: 'Cefalotina vs Cefazolina', class: 'bg-sky-100 text-sky-900 border-sky-200' },
                frecuencia: { name: 'Frecuencia Quirúrgica', class: 'bg-teal-100 text-teal-900 border-teal-200' }
            };

            referencesData.forEach(ref => {
                const card = document.createElement('div');
                card.className = 'bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3 hover:border-purple-300 transition flex flex-col justify-between';
                card.setAttribute('data-cat', ref.cat);
                card.setAttribute('data-text', `${ref.num} ${ref.title} ${ref.authors || ''} ${ref.institution || ''} ${ref.journal || ''}`.toLowerCase());

                const badge = catBadges[ref.cat] || { name: 'Documento Oficial', class: 'bg-slate-100 text-slate-700 border-slate-200' };
                const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(ref.searchQuery || ref.title)}`;

                card.innerHTML = `
                    <div class="space-y-2">
                        <div class="flex items-center justify-between flex-wrap gap-2">
                            <div class="flex items-center gap-2">
                                <span class="px-2.5 py-0.5 rounded font-mono font-bold text-xs bg-purple-900 text-white">${ref.num}</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badge.class}">${badge.name}</span>
                            </div>
                            <span class="text-xs font-semibold text-slate-400">${ref.year || ''}</span>
                        </div>
                        <h3 class="font-bold text-purple-950 text-base leading-snug">${ref.title}</h3>
                        ${ref.authors ? `<p class="text-xs text-slate-600 font-medium"><strong>Autores:</strong> ${ref.authors}</p>` : ''}
                        ${ref.institution ? `<p class="text-xs text-purple-900 font-semibold"><strong>Sociedades / Emisores:</strong> ${ref.institution}</p>` : ''}
                        ${ref.summary ? `
                        <div class="p-3 bg-slate-50 rounded-lg text-xs text-slate-700 border border-slate-200 space-y-1">
                            <strong class="text-slate-900">Resumen y Alcance Clínico:</strong>
                            <p class="leading-relaxed">${ref.summary}</p>
                        </div>` : ''}
                        ${ref.keyTakeaway ? `
                        <div class="p-2.5 bg-purple-50/70 rounded-lg text-xs text-purple-950 border border-purple-200 font-medium">
                            <span class="font-bold text-purple-900">Relevancia para la UVEH:</span> ${ref.keyTakeaway}
                        </div>` : ''}
                    </div>
                    <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span class="text-slate-400 font-mono text-[11px] truncate max-w-[280px] sm:max-w-md">${ref.journal || ''}</span>
                        <div class="flex items-center gap-2 flex-wrap">
                            <button onclick="UVEH.m.profilaxis.copyCitation('${ref.id}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition flex items-center gap-1 border border-slate-300">📋 Copiar Cita</button>
                            ${ref.officialUrl ? `<a href="${ref.officialUrl}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-lg font-semibold transition flex items-center gap-1.5 shadow-sm">🌐 ${ref.officialUrlLabel || 'Enlace Oficial'}</a>` : ''}
                            <a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 bg-purple-800 hover:bg-purple-900 text-white rounded-lg font-semibold transition flex items-center gap-1.5 shadow-sm">🔍 Buscar en Google</a>
                        </div>
                    </div>`;
                container.appendChild(card);
            });
        }

        function filterReferences() {
            const query = (document.getElementById('ref-search')?.value || '').toLowerCase();
            const catFilter = document.getElementById('ref-filter-cat')?.value || 'all';
            document.querySelectorAll('#references-cards-container > div').forEach(card => {
                const text = card.getAttribute('data-text') || '';
                const cat = card.getAttribute('data-cat') || '';
                card.classList.toggle('hidden', !(text.includes(query) && (catFilter === 'all' || cat === catFilter)));
            });
        }

        function copyToClipboard(text, okMsg) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try {
                const ok = document.execCommand('copy');
                showAINotification(ok ? okMsg : 'No se pudo copiar automáticamente.', ok ? 'emerald' : 'amber');
            } catch (e) {
                showAINotification('Error al copiar al portapapeles.', 'rose');
            } finally {
                document.body.removeChild(ta);
            }
        }

        function copyCitation(refId) {
            const ref = referencesData.find(r => r.id === refId);
            if (!ref) return;
            const citation = `${ref.authors ? ref.authors + '. ' : ''}${ref.title}. ${ref.journal ? ref.journal + '. ' : (ref.institution ? ref.institution + '. ' : '')}${ref.officialUrl ? ref.officialUrl : ''}`.trim();
            copyToClipboard(citation, `Cita ${ref.num} copiada al portapapeles.`);
        }

        function downloadBibliographyText() {
            let content = "REFERENCIAS\nProfilaxis Antimicrobiana Perioperatoria - UVEH Hospital UPAEP\n";
            content += "========================================================================\n\n";
            referencesData.forEach(ref => {
                content += `${ref.num}. ${ref.title}\n`;
                if (ref.authors) content += `     Autores: ${ref.authors}\n`;
                if (ref.institution) content += `     Institución: ${ref.institution}\n`;
                if (ref.year) content += `     Año: ${ref.year}\n`;
                if (ref.journal) content += `     Publicación: ${ref.journal}\n`;
                if (ref.officialUrl) content += `     Enlace: ${ref.officialUrl}\n`;
                if (ref.summary) content += `     Resumen: ${ref.summary}\n`;
                if (ref.keyTakeaway) content += `     Relevancia UVEH: ${ref.keyTakeaway}\n`;
                content += "\n------------------------------------------------------------------------\n\n";
            });
            const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Referencias_Profilaxis_UVEH.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function initPKChart() {
            const ctx = document.getElementById('pkChart')?.getContext('2d');
            if (!ctx) return;
            // Vidas medias tomadas de kb.json (punto medio del rango); así la gráfica siempre cuadra con la tabla
            const nombres = ['Cefalotina', 'Cefoxitina', 'Ampicilina-sulbactam', 'Cefuroxima', 'Clindamicina', 'Vancomicina'];
            const medio = txt => { const n = (String(txt).match(/\d+(\.\d+)?/g) || []).map(Number); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0; };
            const filas = nombres.map(n => pkTableData.find(r => r.drug === n)).filter(Boolean);
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: filas.map(r => r.drug),
                    datasets: [{
                        label: 'Vida Media (t1/2 en horas)',
                        data: filas.map(r => Number(medio(r.t12).toFixed(2))),
                        backgroundColor: 'rgba(109,40,217,0.8)',
                        borderColor: '#5b21b6',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: c => ` Vida media (punto medio del rango): ${c.raw} h` } }
                    },
                    scales: { y: { beginAtZero: true, title: { display: true, text: 'Horas (h)', font: { size: 11 } } } }
                }
            });
        }

        // Resistencia de E. coli (%): Tabla 1 de Cornejo-Juárez et al., Gac Med Mex 2026;162:369-387
        // INVIFAR 2020 y PUCRA 2017-2023. Ceftriaxona no se reporta en la tabla; se muestran los marcadores de cefalosporinas de 3ª/4ª generación.
        function initBLEEChart() {
            const ctx = document.getElementById('bleeChart')?.getContext('2d');
            if (!ctx) return;
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Cefotaxima', 'Ceftazidima', 'Cefepima', 'Ciprofloxacino', 'Meropenem'],
                    datasets: [
                        { label: 'INVIFAR 2020', data: [46.3, 45.9, 43.3, 60.7, 0.7], backgroundColor: 'rgba(217,119,6,0.85)', borderWidth: 1 },
                        { label: 'PUCRA 2017-2023', data: [null, 66, 66, 68, 1], backgroundColor: 'rgba(109,40,217,0.8)', borderWidth: 1 }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 10 } } } },
                    scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: '% de aislamientos resistentes', font: { size: 10 } } } }
                }
            });
        }

        // ===== IA: TODO PASA POR EL PROXY /api/consulta (la clave vive en Vercel) =====
        function resumenCalculador() {
            const selProc = document.getElementById('calc-procedure');
            const nombreProc = selProc && selProc.selectedOptions[0] ? selProc.selectedOptions[0].textContent : '';
            return [
                'Procedimiento: ' + nombreProc,
                'Paciente: ' + (document.getElementById('calc-age')?.value || '') + ' años, ' + (document.getElementById('calc-weight')?.value || '') + ' kg',
                'Fármaco: ' + document.getElementById('result-primary-drug').textContent,
                'Ventana: ' + document.getElementById('result-timing').textContent,
                'Recarga: ' + document.getElementById('result-redosing-text').textContent,
                'Duración: ' + document.getElementById('result-duration-text').textContent
            ].join('\n');
        }

        async function callProxy(tarea) {
            const caso = document.getElementById('ai-query-input').value.trim();
            const r = await fetch('/api/profilaxis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tarea, caso, calculo: resumenCalculador() })
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                const e = new Error(data.error || `El servidor no pudo procesar la consulta (código ${r.status}). Intente de nuevo en unos segundos; si se repite, avise a la UVEH.`);
                e.saturado = data.saturado === true || r.status === 503 || r.status === 504;
                e.espera = data.reintentar_en || 30;
                throw e;
            }
            return data;
        }

        let temporizadorEspera = null;

        function aplicarGate() {
            const ok = document.getElementById('ai-gate')?.checked === true;
            ['btn-submit-ai', 'btn-ece-ai'].forEach(id => {
                const b = document.getElementById(id);
                if (!b) return;
                b.disabled = !ok;
                b.classList.toggle('opacity-60', !ok);
                b.classList.toggle('cursor-not-allowed', !ok);
            });
        }

        async function runAI(tarea, titulo, mensajeOk) {
            const query = document.getElementById('ai-query-input')?.value.trim();
            if (!query || query.length < 10) {
                showAINotification('Ingrese los datos del paciente o seleccione un caso de ejemplo.', 'amber');
                return;
            }
            if (document.getElementById('ai-gate')?.checked !== true) {
                showAINotification('Marque la confirmación de caso de alta complejidad para usar el Consultor experto.', 'amber');
                return;
            }
            clearInterval(temporizadorEspera);
            setAILoading(true);
            document.getElementById('ai-output-title').textContent = titulo;
            let sinRespuesta = false;
            try {
                const d = await callProxy(tarea);
                renderAIResult(d);
                showAINotification(d.en_alcance === false ? 'Consulta fuera del alcance de la herramienta.' : mensajeOk, d.en_alcance === false ? 'amber' : 'emerald');
            } catch (err) {
                sinRespuesta = true;
                if (err.saturado) {
                    renderSaturado(tarea, titulo, mensajeOk, err.espera);
                    showAINotification('El servicio de IA tiene alta demanda. Espere unos segundos e intente de nuevo.', 'amber');
                } else {
                    renderAIResult({ en_alcance: false, mensaje: err.message });
                    showAINotification('Ocurrió un error al procesar la solicitud.', 'rose');
                }
            } finally {
                setAILoading(false);
                if (sinRespuesta) {
                    const badge = document.getElementById('ai-status-badge');
                    if (badge) {
                        badge.textContent = 'Sin respuesta';
                        badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800';
                    }
                    document.getElementById('btn-copy-ai')?.classList.add('hidden');
                }
            }
        }

        // Aviso de saturación: pide esperar, muestra cuenta regresiva y habilita el reintento al terminar
        function renderSaturado(tarea, titulo, mensajeOk, espera) {
            const c = document.getElementById('ai-response-container');
            c.replaceChildren();
            const caja = document.createElement('div');
            caja.className = 'p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-2';
            const h = document.createElement('strong');
            h.className = 'block text-sm';
            h.textContent = '⏳ El sistema de IA tiene alta demanda en este momento';
            const p = document.createElement('p');
            p.textContent = 'Hay muchas solicitudes al servicio de inteligencia artificial. Espere unos segundos para que se refresque e intente de nuevo. No necesita volver a escribir el caso: se conserva en pantalla. Mientras tanto, el calculador y el catálogo funcionan con normalidad.';
            const cuenta = document.createElement('p');
            cuenta.className = 'font-semibold';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mt-1 px-3 py-1.5 bg-purple-800 hover:bg-purple-900 text-white text-xs font-bold rounded-lg shadow transition disabled:opacity-60 disabled:cursor-not-allowed';
            btn.disabled = true;
            btn.textContent = 'Reintentar';
            btn.onclick = () => { clearInterval(temporizadorEspera); runAI(tarea, titulo, mensajeOk); };
            caja.append(h, p, cuenta, btn);
            c.append(caja);

            let restante = Math.max(5, Math.min(Number(espera) || 30, 120));
            const pintar = () => {
                if (restante > 0) {
                    cuenta.textContent = `Podrá reintentar en ${restante} s.`;
                } else {
                    cuenta.textContent = 'Ya puede reintentar.';
                    btn.disabled = false;
                    clearInterval(temporizadorEspera);
                }
            };
            pintar();
            temporizadorEspera = setInterval(() => { restante--; pintar(); }, 1000);
        }

        function generateAIConsultation() {
            return runAI('dictamen', 'Dictamen Epidemiológico UVEH - Hospital UPAEP', 'Dictamen generado con la base UVEH.');
        }
        function generateMedicalRecordNote() {
            return runAI('nota_ece', 'Nota Oficial ECE: Justificación de Profilaxis Quirúrgica', 'Nota para expediente generada.');
        }


        function importCalculatorDataToAI() {
            const specEl = document.getElementById('calc-specialty');
            const procEl = document.getElementById('calc-procedure');
            const age = document.getElementById('calc-age')?.value || '45';
            const weight = document.getElementById('calc-weight')?.value || '70';
            const height = document.getElementById('calc-height')?.value || '170';
            const bmi = document.getElementById('calc-bmi-val')?.textContent || '24.2';
            const approach = document.getElementById('calc-approach')?.value || 'abierto';
            const prosthesis = document.getElementById('calc-prosthesis')?.value || 'no';
            const isObstetric = document.getElementById('calc-obstetric')?.checked;
            const allergy = document.getElementById('calc-allergy')?.value;
            const hasMRSA = document.getElementById('calc-mrsa')?.checked;
            const duration = document.getElementById('calc-duration')?.value || '2';
            const bloodLoss = document.getElementById('calc-bloodloss')?.value || '200';

            const specialtyText = specEl?.options[specEl.selectedIndex]?.text || specEl?.value;
            const procedureText = procEl?.options[procEl.selectedIndex]?.text || procEl?.value;
            const allergyMap = {
                none: 'Sin alergia conocida (Tolera betalactámicos)',
                mild: 'Alergia leve / no mediada por IgE (exantema tardío)',
                severe: 'Alergia severa Tipo I IgE (antecedente de anafilaxia o angioedema)'
            };

            const compiledText = `PACIENTE QUIRÚRGICO HOSPITAL UPAEP:
- Especialidad: ${specialtyText}
- Procedimiento: ${procedureText}
- Abordaje: ${approach} | ¿Material protésico/implante?: ${prosthesis === 'si' ? 'SÍ' : 'NO'}
- Datos Antropométricos: Edad: ${age} años | Peso: ${weight} kg | Talla: ${height} cm | IMC: ${bmi} kg/m²
- Paciente gestante: ${isObstetric ? 'SÍ' : 'NO'}
- Perfil Inmunológico: ${allergyMap[allergy] || allergy}
- Riesgo o colonización por SARM: ${hasMRSA ? 'SÍ' : 'NO'}
- Duración quirúrgica estimada: ${duration} horas
- Pérdida hemática prevista: ${bloodLoss} mL`;

            const inputEl = document.getElementById('ai-query-input');
            if (inputEl) inputEl.value = compiledText;
            showAINotification('Datos del calculador importados exitosamente.', 'purple');
        }

        function setAIPreset(caseIndex) {
            const presets = {
                1: `Paciente masculino de 62 años sometido a hemicolectomía izquierda abierta por neoplasia de colon.
- Peso: 78 kg, Talla: 172 cm (IMC 26.4).
- Alergias: Refiere intolerancia gastrointestinal y rash leve no pruriginoso con penicilina hace 15 años.
- Cirugía prolongada de 5.5 horas de duración.
- Sangrado intraoperatorio acumulado de 1,800 mL.
- Se requiere esquema óptimo, momento de refuerzo y fundamentación de por qué evitar Ceftriaxona.`,
                2: `Paciente femenina de 29 años, primigesta a término con 39 semanas de gestación.
- Cesárea de urgencia por trabajo de parto detenido.
- Peso: 108 kg, Talla: 161 cm (IMC: 41.6 kg/m², Obesidad Grado III).
- Sin alergias conocidas a medicamentos.
- Se requiere cálculo de dosis de profilaxis y pauta antes de la incisión en piel.`,
                3: `Paciente masculino de 71 años programado para reemplazo total de cadera derecha con prótesis no cementada.
- Antecedente de prueba de alergia dudosa en la infancia pero sin anafilaxia confirmada.
- Cultivo nasal positivo para S. aureus meticilino-sensible (SAMS).
- Duración prevista: 3.5 horas.
- Solicito conducta sobre uso seguro de Cefalotina frente a alternativas de Clindamicina o Vancomicina.`,
                4: `Médico adscrito solicita justificación para el Comité de Farmacia:
- Paciente de 54 años con colecistectomía abierta electiva.
- El cirujano solicita aplicar Ceftriaxona 1 g IV preoperatorio por conveniencia de posología.
- Se solicita fundamentar por qué la UVEH recomienda Cefalotina (o Ampicilina-sulbactam) y desaconseja Ceftriaxona en este caso.`
            };
            if (presets[caseIndex]) {
                const inputEl = document.getElementById('ai-query-input');
                if (inputEl) inputEl.value = presets[caseIndex];
                showAINotification(`Caso clínico #${caseIndex} cargado. Haga clic en 'Generar Dictamen' para analizar.`, 'purple');
            }
        }

        function setAILoading(isLoading) {
            const spinner = document.getElementById('ai-loading-spinner');
            const container = document.getElementById('ai-response-container');
            const badge = document.getElementById('ai-status-badge');
            const copyBtn = document.getElementById('btn-copy-ai');
            const submitBtn = document.getElementById('btn-submit-ai');

            if (isLoading) {
                spinner?.classList.remove('hidden');
                container?.classList.add('hidden');
                if (badge) {
                    badge.textContent = 'Analizando...';
                    badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 animate-pulse';
                }
                copyBtn?.classList.add('hidden');
                if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('opacity-60', 'cursor-not-allowed'); }
            } else {
                spinner?.classList.add('hidden');
                container?.classList.remove('hidden');
                if (badge) {
                    badge.textContent = 'Completado';
                    badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800';
                }
                copyBtn?.classList.remove('hidden');
                aplicarGate();
            }
        }

        // Render seguro: textContent, nunca innerHTML con texto del modelo
        function renderAIResult(d) {
            const c = document.getElementById('ai-response-container');
            c.replaceChildren();
            if (d.en_alcance === false) { c.append(bloque('Aviso', d.mensaje || 'Sin respuesta.')); return; }
            if (d.fuera_de_base) {
                c.append(bloque('⚠️ Fuera de la base UVEH', d.mensaje || 'Este procedimiento o dato no se encuentra en la base de datos institucional. Consulte al Comité de Infecciones o comuníquese con la UVEH.'));
                if (d.kb_version) c.append(bloque('Versión de la base', d.kb_version));
                return;
            }
            if (d.aviso_sin_cifras) {
                const av = document.createElement('div');
                av.className = 'p-3 mb-2 bg-amber-50 rounded-lg border border-amber-300 text-amber-950';
                const t = document.createElement('strong'); t.textContent = 'Use las cifras del Calculador';
                const pp = document.createElement('p');
                pp.textContent = 'La IA no precisó las dosis y los tiempos en esta respuesta. Tome el fármaco, la dosis, el momento y la redosificación exactos del Calculador y, si tiene dudas, comuníquese con la UVEH.';
                av.append(t, pp);
                c.append(av);
            }
            [['Conducta recomendada', 'dictamen'], ['Fármaco y dosis', 'farmaco_dosis'], ['Cuándo administrar', 'ventana'],
             ['Redosificación', 'redosificacion'], ['Cuándo suspender', 'duracion'], ['Ceftriaxona', 'ceftriaxona'],
             ['Nota para el expediente (ECE)', 'nota_ece']].forEach(([t, k]) => { if (d[k]) c.append(bloque(t, d[k])); });
            c.append(bloqueVerificacion(d));
            if (d.kb_version) c.append(bloque('Versión de la base', d.kb_version));
        }

        // Fuentes bibliográficas del esquema: se toman de la base (campo "fuente" de cada procedimiento)
        function fuentesDeLaRespuesta(d) {
            const ids = new Set((d.fuentes || []).map(String));
            const out = new Set();
            ((KB && KB.procedimientos) || []).forEach(p => { if (ids.has(p.id) && p.src) p.src.split(';').forEach(x => out.add(x.trim())); });
            (d.fuentes || []).forEach(f => { if (/ASHP|HCTM|Gac|OPS|HCUP/i.test(String(f))) out.add(String(f).trim()); });
            return [...out];
        }

        function bloqueVerificacion(d) {
            const div = document.createElement('div');
            div.className = 'p-3 mb-2 bg-emerald-50 rounded-lg border border-emerald-300 text-emerald-950';
            const h = document.createElement('strong'); h.textContent = 'Verificación';
            const p = document.createElement('p');
            const fuentes = fuentesDeLaRespuesta(d);
            const contacto = (KB && KB.contacto_uveh) ? ` (${KB.contacto_uveh})` : '';
            p.textContent = 'El esquema indicado proviene de la base de conocimiento de la UVEH, respaldada por la bibliografía publicada'
                + (fuentes.length ? ` (${fuentes.join('; ')})` : '')
                + '. Puede consultarla en la pestaña Bibliografía. Si tiene cualquier duda, comuníquese con la UVEH' + contacto + '.';
            div.append(h, p);
            return div;
        }

        function bloque(titulo, texto) {
            const div = document.createElement('div');
            div.className = 'p-3 mb-2 bg-purple-50/40 rounded-lg border border-purple-200 whitespace-pre-wrap';
            const h = document.createElement('strong'); h.textContent = titulo;
            const p = document.createElement('p'); p.textContent = texto;
            div.append(h, p);
            return div;
        }

        function copyAIResponse() {
            const container = document.getElementById('ai-response-container');
            if (!container) return;
            copyToClipboard(container.innerText || container.textContent, 'Dictamen copiado al portapapeles.');
        }

        function showAINotification(message, color = 'purple') {
            const box = document.getElementById('ai-notification-box');
            if (!box) return;
            const colorClasses = {
                emerald: 'bg-emerald-50 border border-emerald-200 text-emerald-900',
                amber: 'bg-amber-50 border border-amber-200 text-amber-900',
                rose: 'bg-rose-50 border border-rose-200 text-rose-900',
                purple: 'bg-purple-50 border border-purple-200 text-purple-900'
            };
            box.className = `p-3 rounded-lg text-xs space-y-1 ${colorClasses[color] || colorClasses.purple}`;
            const p = document.createElement('p'); p.className = 'font-medium'; p.textContent = message;
            box.replaceChildren(p);
            box.classList.remove('hidden');
            clearTimeout(showAINotification._t);
            showAINotification._t = setTimeout(() => box.classList.add('hidden'), 6000);
        }

        // ===== FUNCIONES EXPUESTAS A LOS ATRIBUTOS EN LÍNEA DEL HTML =====
        window.UVEH = window.UVEH || {};
        window.UVEH.m = window.UVEH.m || {};
        window.UVEH.m.profilaxis = { aplicarGate, calculateBMI, calculateCDSS, copyAIResponse, copyCitation, downloadBibliographyText, filterCatalog, filterReferences, generateAIConsultation, generateMedicalRecordNote, importCalculatorDataToAI, mostrarNotaObstetrica, obstetricaManual, runRedoseSimulation, searchProcedureOptions, setAIPreset, syncEspecialidadConProcedimiento, updateProcedureOptions };

        // ===== ARRANQUE DEL MÓDULO (el cascarón carga primero el HTML y luego este script) =====
        (async () => {
            try {
                await loadKB();
            } catch (e) {
                const raiz = document.querySelector('[data-modulo="profilaxis"]');
                if (raiz) {
                    raiz.innerHTML = '<div class="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-sm">No se pudo cargar la base de conocimiento de este módulo. Verifique que el archivo modulos/profilaxis/kb.json esté en el repositorio.</div>';
                }
                return;
            }
            updateProcedureOptions();
            renderCatalog();
            renderPKTable();
            const nc = document.getElementById('cefalotina-note');
            if (nc) nc.textContent = regla('nota_cefalotina_ui', '');
            renderReferences();
            initPKChart();
            initBLEEChart();
            calculateBMI();
            calculateCDSS();
            runRedoseSimulation();
        })();

})();
