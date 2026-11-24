// Herois_baiduu para Bedrock — o Flash.
// Poder guardado no jogador (propriedades dinâmicas), velocidade por nível, habilidades pelo Anel do Flash,
// seringa e cápsulas, V-9 e a Câmara de Transformação.
import { world, system, ItemStack, EntityDamageCause } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const NS = "herois:";
const P = {
    hero: NS + "heroi",
    nivel: NS + "nivel",
    xp: NS + "xp",
    sel: NS + "nivel_sel",
    hab: NS + "habilidade",
    v9Ate: NS + "v9_ate",
    quedaAte: NS + "v9_queda_ate",
    temp: NS + "v9_temporario",
};

const NIVEL_MAX = 10;
const BONUS_V9 = 5;
// multiplicador da velocidade de andar por nível (0 = normal), como no mod Java
const MULT = [1, 3, 3.5, 4, 4.5, 5, 5.5, 6, 16.9, 18.75, 20.6, 23, 25.5, 28, 31, 34];
const BASE_SPEED = 0.1;
const V9_TICKS = 20 * 60 * 5;
const QUEDA_TICKS = 20 * 30;

// ---------------------------------------------------------------- estado

function get(p, k, d) {
    const v = p.getDynamicProperty(k);
    return v === undefined ? d : v;
}
function set(p, k, v) {
    p.setDynamicProperty(k, v);
}
function isFlash(p) {
    return get(p, P.hero, "") === "flash";
}
function nivel(p) {
    return get(p, P.nivel, 1);
}
function agora() {
    return system.currentTick;
}
function emQueda(p) {
    return get(p, P.quedaAte, 0) > agora();
}
function bonus(p) {
    return get(p, P.v9Ate, 0) > agora() ? BONUS_V9 : 0;
}
function nivelMaxSel(p) {
    return Math.min(MULT.length - 1, nivel(p) + bonus(p));
}
function xpParaProximo(n) {
    return 400 * n;
}
function msg(p, texto) {
    p.sendMessage(texto);
}
function barra(p, texto) {
    try {
        p.onScreenDisplay.setActionBar(texto);
    } catch (e) {
        /* ignora */
    }
}

function tornarFlash(p, n, temporario) {
    set(p, P.hero, "flash");
    set(p, P.nivel, Math.max(1, Math.min(NIVEL_MAX, n)));
    set(p, P.sel, Math.max(1, Math.min(NIVEL_MAX, n)));
    set(p, P.xp, get(p, P.xp, 0));
    set(p, P.temp, temporario ? agora() + V9_TICKS : 0);
    darAnel(p);
}

function tirarPoder(p) {
    set(p, P.hero, "");
    set(p, P.temp, 0);
    set(p, P.v9Ate, 0);
    set(p, P.quedaAte, 0);
    velocidade(p, 0);
    LENTO.delete(p.id);
}

// ---------------------------------------------------------------- inventário

function inventario(p) {
    return p.getComponent("minecraft:inventory").container;
}
function temItem(p, id) {
    const c = inventario(p);
    for (let i = 0; i < c.size; i++) {
        const it = c.getItem(i);
        if (it && it.typeId === id) return true;
    }
    return false;
}
function darItem(p, stack) {
    const sobra = inventario(p).addItem(stack);
    if (sobra) p.dimension.spawnItem(sobra, p.location);
}
function gastarNaMao(p) {
    const c = inventario(p);
    const slot = p.selectedSlotIndex;
    const it = c.getItem(slot);
    if (!it) return;
    if (it.amount > 1) {
        it.amount -= 1;
        c.setItem(slot, it);
    } else {
        c.setItem(slot, undefined);
    }
}
function darAnel(p) {
    if (!temItem(p, NS + "anel_flash")) darItem(p, new ItemStack(NS + "anel_flash", 1));
}

// ---------------------------------------------------------------- velocidade

const MUDOU = new Set();

function velocidade(p, mult) {
    const mov = p.getComponent("minecraft:movement");
    if (mult <= 1) {
        if (MUDOU.has(p.id)) {
            try {
                mov.resetToDefaultValue();
            } catch (e) {
                try {
                    mov.setCurrentValue(BASE_SPEED);
                } catch (e2) {
                    /* ignora */
                }
            }
            MUDOU.delete(p.id);
        }
        return;
    }
    try {
        mov.setCurrentValue(BASE_SPEED * mult);
        MUDOU.add(p.id);
    } catch (e) {
        // reserva: o efeito de velocidade (cada nível = +20%)
        p.addEffect("speed", 10, { amplifier: Math.min(255, Math.round((mult - 1) * 5)), showParticles: false });
    }
}

// ---------------------------------------------------------------- loop

const ULTIMA = new Map();
const LENTO = new Map(); // câmera lenta: id -> tick final

system.runInterval(() => {
    const t = agora();
    for (const p of world.getAllPlayers()) {
        try {
            tickJogador(p, t);
        } catch (e) {
            /* um jogador com erro não para os outros */
        }
    }
}, 2);

function tickJogador(p, t) {
    // poder temporário da V-9 acabando
    const temp = get(p, P.temp, 0);
    if (isFlash(p) && temp > 0 && temp <= t) {
        tirarPoder(p);
        msg(p, "§eO efeito da V-9 acabou. A velocidade foi embora.");
        return;
    }
    const v9 = get(p, P.v9Ate, 0);
    if (v9 > 0 && v9 <= t) {
        set(p, P.v9Ate, 0);
        set(p, P.quedaAte, t + QUEDA_TICKS);
        if (get(p, P.sel, 1) > nivel(p)) set(p, P.sel, nivel(p));
        msg(p, "§cA V-9 acabou: 30 segundos sem poder.");
    }
    if (!isFlash(p)) {
        velocidade(p, 0);
        return;
    }
    const sel = Math.min(get(p, P.sel, 1), nivelMaxSel(p));
    const correndo = p.isSprinting && !emQueda(p) && sel > 0;
    velocidade(p, correndo ? MULT[sel] : 0);

    // movimento: rastro de faíscas e experiência
    const loc = p.location;
    const antes = ULTIMA.get(p.id);
    ULTIMA.set(p.id, { x: loc.x, y: loc.y, z: loc.z, d: p.dimension.id });
    if (antes && antes.d === p.dimension.id) {
        const dx = loc.x - antes.x;
        const dz = loc.z - antes.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (correndo && dist > 0.6 && dist < 60) {
            p.dimension.spawnParticle(NS + "flash_spark", { x: loc.x, y: loc.y + 0.9, z: loc.z });
            p.dimension.spawnParticle(NS + "flash_spark", { x: loc.x - dx * 0.5, y: loc.y + 0.4, z: loc.z - dz * 0.5 });
            ganharXp(p, dist * 0.5);
        }
    }

    // cura acelerada
    if (t % 100 === 0) {
        const vida = p.getComponent("minecraft:health");
        if (vida && vida.currentValue < vida.effectiveMax) {
            p.addEffect("regeneration", 120, { amplifier: Math.min(2, Math.floor(nivel(p) / 4)), showParticles: false });
        }
    }

    // câmera lenta ligada
    const ate = LENTO.get(p.id);
    if (ate !== undefined) {
        if (ate <= t) {
            LENTO.delete(p.id);
            msg(p, "§7Câmera lenta desligada.");
        } else if (t % 4 === 0) {
            cameraLentaTick(p);
        }
    }

    if (t % 20 === 0) {
        const extra = bonus(p) > 0 ? " §b(+5 V-9)" : emQueda(p) ? " §c(sem poder)" : "";
        barra(p, `§c⚡ Flash §fnível §e${nivel(p)}§f · velocidade §e${sel}${extra}`);
    }
}

function ganharXp(p, q) {
    let n = nivel(p);
    if (n >= NIVEL_MAX) return;
    let xp = get(p, P.xp, 0) + q;
    while (n < NIVEL_MAX && xp >= xpParaProximo(n)) {
        xp -= xpParaProximo(n);
        n++;
        set(p, P.nivel, n);
        if (get(p, P.sel, 1) === n - 1) set(p, P.sel, n);
        p.playSound("random.levelup");
        msg(p, `§e⚡ Você chegou ao nível ${n} do Flash!` + (n === NIVEL_MAX ? " (nível máximo)" : ""));
        const nova = HABILIDADES.find((h) => h.nivel === n);
        if (nova) msg(p, `§aNova habilidade: §f${nova.nome}`);
    }
    set(p, P.xp, xp);
}

// ---------------------------------------------------------------- habilidades

const RECARGA = new Map();

function alvoNaFrente(p, alcance) {
    const hits = p.getEntitiesFromViewDirection({ maxDistance: alcance });
    for (const h of hits) {
        if (h.entity && h.entity.id !== p.id && h.entity.isValid()) return h.entity;
    }
    return undefined;
}
function pontoNaFrente(p, alcance) {
    const e = alvoNaFrente(p, alcance);
    if (e) return e.location;
    const b = p.getBlockFromViewDirection({ maxDistance: alcance });
    if (b) return { x: b.block.location.x + 0.5, y: b.block.location.y + 1, z: b.block.location.z + 0.5 };
    const v = p.getViewDirection();
    const o = p.getHeadLocation();
    return { x: o.x + v.x * alcance, y: o.y + v.y * alcance, z: o.z + v.z * alcance };
}
function vivosPerto(p, raio) {
    return p.dimension
        .getEntities({ location: p.location, maxDistance: raio, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] })
        .filter((e) => e.id !== p.id && e.getComponent("minecraft:health"));
}
function bater(p, e, dano) {
    try {
        e.applyDamage(dano, { cause: EntityDamageCause.entityAttack, damagingEntity: p });
    } catch (err) {
        /* alvo sumiu */
    }
}
function empurrar(e, dx, dz, forca, alto) {
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    try {
        e.applyKnockback(dx / len, dz / len, forca, alto);
    } catch (err) {
        /* alguns não recebem */
    }
}
function depois(ticks, fn) {
    system.runTimeout(() => {
        try {
            fn();
        } catch (e) {
            /* ignora */
        }
    }, ticks);
}

const HABILIDADES = [
    {
        id: "barragem",
        nome: "Barragem de Socos",
        nivel: 1,
        recarga: 3,
        usar(p) {
            const alvo = alvoNaFrente(p, 5);
            if (!alvo) return "Nenhum alvo na frente.";
            for (let i = 0; i < 10; i++) {
                depois(i * 2, () => {
                    if (!alvo.isValid()) return;
                    bater(p, alvo, 2 + nivel(p) * 0.3);
                    p.dimension.spawnParticle("minecraft:critical_hit_emitter", alvo.location);
                    p.playSound("random.swim", { pitch: 2.0, volume: 0.4 });
                });
            }
        },
    },
    {
        id: "raio",
        nome: "Lançamento de Raios",
        nivel: 2,
        recarga: 6,
        usar(p) {
            const pt = pontoNaFrente(p, 60);
            p.addEffect("fire_resistance", 60, { showParticles: false });
            p.dimension.spawnEntity("minecraft:lightning_bolt", pt);
            for (const e of p.dimension.getEntities({ location: pt, maxDistance: 3 })) {
                if (e.id !== p.id && e.getComponent("minecraft:health")) bater(p, e, 25);
            }
        },
    },
    {
        id: "vento",
        nome: "Tornados com as Mãos",
        nivel: 3,
        recarga: 8,
        usar(p) {
            for (let i = 0; i < 15; i++) {
                depois(i * 4, () => {
                    const v = p.getViewDirection();
                    const o = p.location;
                    for (const e of vivosPerto(p, 10)) {
                        const dx = e.location.x - o.x;
                        const dz = e.location.z - o.z;
                        const len = Math.sqrt(dx * dx + dz * dz) || 1;
                        if ((dx * v.x + dz * v.z) / len > 0.6) empurrar(e, dx, dz, 1.6, 0.35);
                    }
                    for (let k = 1; k < 8; k++) {
                        p.dimension.spawnParticle("minecraft:white_smoke_particle", {
                            x: o.x + v.x * k + Math.sin(i + k) * 0.6,
                            y: o.y + 1.2 + v.y * k,
                            z: o.z + v.z * k + Math.cos(i + k) * 0.6,
                        });
                    }
                });
            }
        },
    },
    {
        id: "corrida",
        nome: "Corrida de Socos",
        nivel: 4,
        recarga: 10,
        usar(p) {
            const alvos = vivosPerto(p, 25)
                .sort((a, b) => dist(a.location, p.location) - dist(b.location, p.location))
                .slice(0, 5);
            if (alvos.length === 0) return "Ninguém por perto.";
            alvos.forEach((alvo, i) => {
                depois(i * 6, () => {
                    if (!alvo.isValid()) return;
                    const a = alvo.location;
                    const d = p.location;
                    const dx = d.x - a.x;
                    const dz = d.z - a.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1;
                    p.teleport({ x: a.x + (dx / len) * 1.2, y: a.y, z: a.z + (dz / len) * 1.2 }, { facingLocation: a });
                    p.dimension.spawnParticle(NS + "flash_spark", p.location);
                    for (let k = 0; k < 4; k++) depois(k, () => alvo.isValid() && bater(p, alvo, 4));
                });
            });
        },
    },
    {
        id: "lento",
        nome: "Câmera Lenta",
        nivel: 5,
        recarga: 2,
        usar(p) {
            if (LENTO.has(p.id)) {
                LENTO.delete(p.id);
                return "Câmera lenta desligada.";
            }
            LENTO.set(p.id, agora() + 20 * 15);
            msg(p, "§bCâmera lenta: tudo em 15 blocos fica lento por 15 segundos.");
        },
    },
    {
        id: "tornado",
        nome: "Tornado de Velocidade",
        nivel: 6,
        recarga: 15,
        usar(p) {
            for (let i = 0; i < 50; i++) {
                depois(i * 2, () => {
                    const c = p.location;
                    for (let k = 0; k < 6; k++) {
                        const ang = i * 0.5 + (k * Math.PI) / 3;
                        p.dimension.spawnParticle(NS + "flash_spark", {
                            x: c.x + Math.cos(ang) * 4,
                            y: c.y + 0.3 + (k % 3),
                            z: c.z + Math.sin(ang) * 4,
                        });
                    }
                    for (const e of vivosPerto(p, 12)) {
                        const dx = c.x - e.location.x;
                        const dz = c.z - e.location.z;
                        // puxa girando para o centro
                        empurrar(e, dx - dz * 0.6, dz + dx * 0.6, 0.6, 0.15);
                        if (i % 10 === 0) bater(p, e, 3);
                    }
                });
            }
        },
    },
    {
        id: "vibrar",
        nome: "Vibração Molecular",
        nivel: 7,
        recarga: 3,
        usar(p) {
            const v = p.getViewDirection();
            const o = p.location;
            const h = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
            const dx = v.x / h;
            const dz = v.z / h;
            let parede = false;
            for (let k = 1; k <= 12; k++) {
                const x = o.x + dx * k;
                const z = o.z + dz * k;
                const pe = p.dimension.getBlock({ x, y: o.y, z });
                const cabeca = p.dimension.getBlock({ x, y: o.y + 1, z });
                if (!pe || !cabeca) break;
                const livre = pe.isAir && cabeca.isAir;
                if (!livre) parede = true;
                else if (parede) {
                    p.teleport({ x: Math.floor(x) + 0.5, y: o.y, z: Math.floor(z) + 0.5 }, { keepVelocity: false });
                    p.dimension.spawnParticle(NS + "flash_spark", p.location);
                    p.playSound("mob.endermen.portal", { pitch: 1.8 });
                    return;
                }
            }
            return parede ? "A parede é grossa demais." : "Nenhuma parede na frente.";
        },
    },
    {
        id: "massa",
        nome: "Soco de Massa Infinita",
        nivel: 9,
        recarga: 30,
        usar(p) {
            const alvo = alvoNaFrente(p, 40);
            if (!alvo) return "Nenhum alvo na frente.";
            msg(p, "§eCorrendo em círculos para carregar o soco...");
            for (let i = 0; i < 30; i++) {
                depois(i, () => {
                    const c = p.location;
                    for (let k = 0; k < 4; k++) {
                        const ang = i * 0.7 + (k * Math.PI) / 2;
                        p.dimension.spawnParticle(NS + "flash_spark", {
                            x: c.x + Math.cos(ang) * 7,
                            y: c.y + 0.5,
                            z: c.z + Math.sin(ang) * 7,
                        });
                    }
                });
            }
            depois(32, () => {
                if (!alvo.isValid()) return;
                const a = alvo.location;
                const d = p.location;
                p.teleport({ x: a.x + (d.x - a.x) * 0.1, y: a.y, z: a.z + (d.z - a.z) * 0.1 }, { facingLocation: a });
                bater(p, alvo, 100);
                empurrar(alvo, a.x - d.x, a.z - d.z, 6, 1.2);
                p.dimension.spawnParticle("minecraft:huge_explosion_emitter", a);
                p.dimension.playSound("random.explode", a);
            });
        },
    },
];

function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cameraLentaTick(p) {
    for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 15 })) {
        if (e.id === p.id) continue;
        if (e.getComponent("minecraft:health")) {
            try {
                e.addEffect("slowness", 10, { amplifier: 6, showParticles: false });
                e.addEffect("mining_fatigue", 10, { amplifier: 3, showParticles: false });
            } catch (err) {
                /* ignora */
            }
        } else if (e.typeId !== "minecraft:item") {
            // flechas e projéteis freiam
            try {
                const v = e.getVelocity();
                e.applyImpulse({ x: -v.x * 0.6, y: -v.y * 0.4, z: -v.z * 0.6 });
            } catch (err) {
                /* não é projétil */
            }
        }
    }
}

function usarHabilidade(p) {
    if (emQueda(p)) {
        msg(p, "§cSem poder até a V-9 passar.");
        return;
    }
    const lista = desbloqueadas(p);
    const id = get(p, P.hab, "barragem");
    const h = lista.find((x) => x.id === id) || lista[0];
    const t = agora();
    const chave = p.id + h.id;
    const pronto = RECARGA.get(chave) || 0;
    if (pronto > t) {
        barra(p, `§c${h.nome}: espere ${Math.ceil((pronto - t) / 20)} s`);
        return;
    }
    const erro = h.usar(p);
    if (erro) {
        barra(p, "§7" + erro);
        return;
    }
    RECARGA.set(chave, t + h.recarga * 20);
}

function desbloqueadas(p) {
    const n = nivelMaxSel(p);
    return HABILIDADES.filter((h) => h.nivel <= n);
}

// ---------------------------------------------------------------- menu do anel

function menu(p) {
    const sel = get(p, P.sel, 1);
    const atual = HABILIDADES.find((h) => h.id === get(p, P.hab, "barragem")) || HABILIDADES[0];
    const prox = nivel(p) >= NIVEL_MAX ? "máximo" : `${Math.floor(get(p, P.xp, 0))}/${xpParaProximo(nivel(p))} de experiência`;
    const f = new ActionFormData()
        .title("⚡ Flash")
        .body(`Nível ${nivel(p)} (${prox})\nCorra (Ctrl/correr) para usar a velocidade.`)
        .button(`Velocidade: nível ${sel}`)
        .button(`Habilidade: ${atual.nome}`)
        .button("Como usar");
    f.show(p).then((r) => {
        if (r.canceled) return;
        if (r.selection === 0) menuVelocidade(p);
        else if (r.selection === 1) menuHabilidade(p);
        else
            msg(
                p,
                "§e⚡ Flash: §fcorra para usar a supervelocidade no nível escolhido. Use o Anel do Flash para a habilidade escolhida; agachado + usar abre este menu. Correndo você ganha experiência e sobe de nível (até 10), liberando habilidades."
            );
    });
}

function menuVelocidade(p) {
    const max = nivelMaxSel(p);
    const f = new ActionFormData().title("Velocidade").body("Escolha a velocidade ao correr.");
    f.button("0 (normal)");
    for (let i = 1; i <= max; i++) f.button(`Nível ${i}` + (i > nivel(p) ? " (V-9)" : ""));
    f.show(p).then((r) => {
        if (r.canceled) return;
        set(p, P.sel, r.selection);
        barra(p, `§eVelocidade: nível ${r.selection}`);
    });
}

function menuHabilidade(p) {
    const lista = desbloqueadas(p);
    const f = new ActionFormData().title("Habilidades").body("Escolha a habilidade do anel.");
    for (const h of HABILIDADES) {
        f.button(h.nivel <= nivelMaxSel(p) ? h.nome : `§8${h.nome} (nível ${h.nivel})`);
    }
    f.show(p).then((r) => {
        if (r.canceled) return;
        const h = HABILIDADES[r.selection];
        if (!lista.includes(h)) {
            msg(p, `§cLiberada no nível ${h.nivel}.`);
            return;
        }
        set(p, P.hab, h.id);
        barra(p, `§eHabilidade: ${h.nome}`);
    });
}

// ---------------------------------------------------------------- itens

world.afterEvents.itemUse.subscribe((ev) => {
    const p = ev.source;
    const it = ev.itemStack;
    if (!p || !it || p.typeId !== "minecraft:player") return;
    switch (it.typeId) {
        case NS + "anel_flash":
            if (!isFlash(p)) {
                msg(p, "§7O anel só responde ao Flash.");
                return;
            }
            if (p.isSneaking) menu(p);
            else usarHabilidade(p);
            break;
        case NS + "seringa":
            usarSeringa(p);
            break;
        case NS + "capsula_flash":
            usarCapsula(p, it);
            break;
        case NS + "capsula_v9":
            usarV9(p);
            break;
    }
});

function usarSeringa(p) {
    if (!isFlash(p) || get(p, P.temp, 0) > 0) {
        msg(p, "§7Você não tem um poder para extrair.");
        return;
    }
    const n = nivel(p);
    gastarNaMao(p);
    tirarPoder(p);
    const cap = new ItemStack(NS + "capsula_flash", 1);
    cap.setLore([`§7Nível: ${n}`]);
    darItem(p, cap);
    p.playSound("random.pop");
    msg(p, `§eO poder do Flash saiu de você e foi para a cápsula (nível ${n}).`);
}

function usarCapsula(p, it) {
    if (isFlash(p)) {
        msg(p, "§7Você já é o Flash.");
        return;
    }
    let n = 1;
    for (const l of it.getLore()) {
        const m = /N[ií]vel:\s*(\d+)/.exec(l.replace(/§./g, ""));
        if (m) n = parseInt(m[1], 10);
    }
    gastarNaMao(p);
    darItem(p, new ItemStack(NS + "seringa", 1));
    tornarFlash(p, n, false);
    p.dimension.spawnParticle("minecraft:huge_explosion_emitter", p.location);
    p.playSound("random.levelup");
    msg(p, `§e⚡ A essência do Flash corre nas suas veias (nível ${n}).`);
}

function usarV9(p) {
    gastarNaMao(p);
    p.playSound("random.drink");
    if (isFlash(p) && get(p, P.temp, 0) === 0) {
        if (emQueda(p)) {
            msg(p, "§cSeu corpo ainda não se recuperou da última V-9.");
            return;
        }
        set(p, P.v9Ate, agora() + V9_TICKS);
        msg(p, "§b⚡ V-9: +5 níveis de velocidade por 5 minutos.");
        return;
    }
    if (isFlash(p)) {
        set(p, P.temp, agora() + V9_TICKS);
        msg(p, "§bA V-9 foi renovada por 5 minutos.");
        return;
    }
    tornarFlash(p, 5, true);
    msg(p, "§b⚡ V-9: você tem a velocidade do Flash (nível 5) por 5 minutos.");
}

// a Câmara de Transformação: o composto químico usado nela + um raio
const EM_CAMARA = new Set();
world.afterEvents.itemUseOn.subscribe((ev) => {
    const p = ev.source;
    if (!p || p.typeId !== "minecraft:player" || !ev.itemStack) return;
    if (ev.itemStack.typeId !== NS + "composto_flash" || ev.block.typeId !== NS + "camara_transformacao") return;
    if (EM_CAMARA.has(p.id)) return;
    if (isFlash(p)) {
        msg(p, "§7Você já é o Flash.");
        return;
    }
    gastarNaMao(p);
    EM_CAMARA.add(p.id);
    const b = ev.block.location;
    const centro = { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 };
    msg(p, "§eA câmara está carregando os químicos... fique em cima dela!");
    p.teleport(centro);
    for (let i = 0; i < 60; i += 4) {
        depois(i, () => {
            p.dimension.spawnParticle(NS + "flash_spark", { x: centro.x, y: centro.y + 1, z: centro.z });
            p.dimension.spawnParticle("minecraft:electric_spark_particle", { x: centro.x, y: centro.y + 0.5, z: centro.z });
            p.playSound("beacon.ambient", { pitch: 1 + i / 60 });
        });
    }
    depois(60, () => {
        EM_CAMARA.delete(p.id);
        p.addEffect("resistance", 60, { amplifier: 255, showParticles: false });
        p.addEffect("fire_resistance", 100, { showParticles: false });
        p.dimension.spawnEntity("minecraft:lightning_bolt", p.location);
        depois(2, () => {
            tornarFlash(p, 1, false);
            p.onScreenDisplay.setTitle("§c⚡ Você é o Flash!", {
                subtitle: "§fCorra para usar a velocidade · use o Anel do Flash",
                fadeInDuration: 10,
                stayDuration: 60,
                fadeOutDuration: 20,
            });
        });
    });
});

// o anel volta depois de morrer
world.afterEvents.playerSpawn.subscribe((ev) => {
    const p = ev.player;
    ULTIMA.delete(p.id);
    if (isFlash(p)) depois(10, () => darAnel(p));
});
