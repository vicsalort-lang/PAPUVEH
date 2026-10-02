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

        // ----- Despliegue gradual: buscador y especialidad -> procedimiento -> datos del paciente -----
        const porId = id => document.getElementById(id);
        function revelar(el) {
            if (!el) return;
            const estabaOculto = el.classList.contains('hidden');
            el.classList.remove('hidden');
            if (estabaOculto) { el.classList.remove('revelar'); void el.offsetWidth; el.classList.add('revelar'); }
        }
        function ocultar(el) { if (el) { el.classList.add('hidden'); el.classList.remove('revelar'); } }
        function estadoVacio(vacio) {
            const v = porId('cdss-vacio'), r = porId('cdss-result-card');
            if (v) v.classList.toggle('hidden', !vacio);
            if (r) r.classList.toggle('hidden', vacio);
        }
        function llenarProcedimientos(lista, conEspecialidad) {
            const procSelect = porId('calc-procedure');
            const previo = procSelect.value;
            procSelect.innerHTML = '';
            const ph = document.createElement('option');
            ph.value = ''; ph.disabled = true; ph.selected = true;
            ph.textContent = lista.length ? 'Seleccione' : 'Sin resultados';
            procSelect.appendChild(ph);
            lista.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = conEspecialidad ? `${item.name} (${item.spec})` : item.name;
                procSelect.appendChild(opt);
            });
            if (previo && lista.some(i => i.id === previo)) procSelect.value = previo;   // conserva la elección si sigue disponible
            return procSelect;
        }

        // Cambio de especialidad hecho por la persona: se limpia la búsqueda
        function elegirEspecialidad() {
            const bs = porId('calc-proc-search');
            if (bs) bs.value = '';
            updateProcedureOptions();
        }

        function updateProcedureOptions() {
            const specVal = porId('calc-specialty').value;
            if (!porId('calc-procedure')) return;
            if (!specVal) {                       // aún sin especialidad: solo se ven el buscador y la especialidad
                ocultar(porId('calc-paso-proc')); ocultar(porId('calc-paso-datos')); estadoVacio(true);
                return;
            }
            const mappedSpec = specialtyMapping[specVal] || specVal;
            const filtered = catalogData.filter(item => item.spec.toLowerCase() === mappedSpec.toLowerCase());
            const lista = filtered.length > 0 ? filtered : catalogData;
            const procSelect = llenarProcedimientos(lista, false);
            revelar(porId('calc-paso-proc'));
            if (procSelect.value) { revelar(porId('calc-paso-datos')); calculateCDSS(); }
            else { ocultar(porId('calc-paso-datos')); estadoVacio(true); }
        }

        // Cambio de procedimiento (lo elige la persona o la búsqueda): aparecen los datos del paciente y el esquema
        function elegirProcedimiento() {
            if (!porId('calc-procedure').value) return;
            syncEspecialidadConProcedimiento();
            revelar(porId('calc-paso-datos'));
            calculateCDSS();
        }

        // Valor del selector de especialidad que corresponde al nombre de especialidad de un procedimiento
        function valorEspecialidad(nombreSpec) {
            const e = Object.entries(specialtyMapping).find(([, n]) => n === nombreSpec);
            return e ? e[0] : null;
        }

        // Mientras hay una búsqueda activa, el selector de especialidad sigue al procedimiento elegido
        function syncEspecialidadConProcedimiento() {
            const q = norm(porId('calc-proc-search')?.value).trim();
            if (q.length < 2) return;
            const sel = porId('calc-specialty');
            const proc = porId('calc-procedure');
            const item = catalogData.find(p => p.id === proc?.value);
            const v = item ? valorEspecialidad(item.spec) : null;
            if (sel && v) sel.value = v; // asignar el valor por código no dispara el evento "change"
        }

        function searchProcedureOptions() {
            const q = norm(porId('calc-proc-search')?.value).trim();
            if (!porId('calc-procedure')) return;
            if (q.length < 2) { updateProcedureOptions(); return; }
            const palabras = q.split(/\s+/);
            const hallados = catalogData.filter(it => {
                const t = norm(`${it.name} ${it.spec} ${it.path} ${it.first} ${it.alias || ''}`);
                return palabras.every(p => t.includes(p));
            });
            const procSelect = llenarProcedimientos(hallados, true);
            revelar(porId('calc-paso-proc'));
            if (hallados.length === 1) procSelect.value = hallados[0].id;                  // un solo resultado: se elige solo
            if (procSelect.value) { elegirProcedimiento(); }
            else { ocultar(porId('calc-paso-datos')); estadoVacio(true); }
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
            const procObj = procSelect.value ? catalogData.find(p => p.id === procSelect.value) : null;
            if (!procObj) { estadoVacio(true); return; }
            estadoVacio(false);
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

            // Con alergia a betalactámicos marcada se muestra únicamente el cuadro de alergia (no el esquema con penicilinas/cefalosporinas)
            const alergia = (allergy === 'severe' || allergy === 'mild') && !noAplica;
            const cajaPrimaria = document.getElementById('result-primary-box');
            const cajaAlergia = document.getElementById('result-alt-box');
            const tituloAlergia = document.getElementById('result-alt-title');
            if (cajaPrimaria) cajaPrimaria.classList.toggle('hidden', alergia);
            if (cajaAlergia) cajaAlergia.classList.toggle('md:col-span-2', alergia);
            if (tituloAlergia) tituloAlergia.textContent = alergia && allergy === 'mild' ? 'Alternativa por alergia leve (no IgE)' : 'Alternativa por alergia severa (IgE)';
            const notaAlt = document.getElementById('result-alt-note');
            if (notaAlt) notaAlt.classList.toggle('hidden', noAplica || fijo);

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
            const textoRec = alergia ? altText : primaryDrugText;
            const primero = Object.keys(mapaRec)
                .map(k => [k, textoRec.indexOf(k)]).filter(([k, p]) => p >= 0)
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
                if (textoRec.includes('Vancomicina')) redoseMsg += ' La vancomicina no requiere refuerzo.';
            } else {
                redoseMsg = 'No requiere dosis de refuerzo durante el acto quirúrgico habitual.';
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
                mostrarAviso(ok ? okMsg : 'No se pudo copiar automáticamente.', ok ? 'emerald' : 'amber');
            } catch (e) {
                mostrarAviso('Error al copiar al portapapeles.', 'rose');
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

        // ===== AVISO BREVE (por ejemplo, al copiar una cita) =====
        function mostrarAviso(mensaje, color) {
            const colores = {
                emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
                amber: 'bg-amber-50 border-amber-200 text-amber-900',
                rose: 'bg-rose-50 border-rose-200 text-rose-900'
            };
            let caja = document.getElementById('uveh-aviso');
            if (!caja) {
                caja = document.createElement('div');
                caja.id = 'uveh-aviso';
                caja.setAttribute('role', 'status');
                document.body.appendChild(caja);
            }
            caja.className = 'fixed bottom-4 right-4 z-50 max-w-xs p-3 rounded-lg border text-xs font-medium shadow-lg ' + (colores[color] || colores.emerald);
            caja.textContent = mensaje;
            clearTimeout(mostrarAviso._t);
            mostrarAviso._t = setTimeout(() => caja.classList.add('hidden'), 4000);
        }

        // ===== FUNCIONES EXPUESTAS A LOS ATRIBUTOS EN LÍNEA DEL HTML =====
        window.UVEH = window.UVEH || {};
        window.UVEH.m = window.UVEH.m || {};
        window.UVEH.m.profilaxis = { calculateBMI, calculateCDSS, copyCitation, downloadBibliographyText, elegirEspecialidad, elegirProcedimiento, filterCatalog, filterReferences, mostrarNotaObstetrica, obstetricaManual, runRedoseSimulation, searchProcedureOptions, syncEspecialidadConProcedimiento, updateProcedureOptions };

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
            renderReferences();
            initPKChart();
            initBLEEChart();
            calculateBMI();
            calculateCDSS();
            runRedoseSimulation();
        })();

})();
