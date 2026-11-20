// Lógica pura para el mapa de rutas de Lima Metropolitana y Callao, estacionamiento base y analítica del repertorio.
// Sin dependencias de React ni del DOM para poder probarse directamente en Node.
import type { Despacho } from './types.ts'

export type ZonaLima = 'Lima Norte' | 'Lima Centro' | 'Lima Este' | 'Lima Moderna' | 'Lima Sur' | 'Callao'

export type DistritoLima = {
  nombre: string
  zona: ZonaLima
  lat: number
  lng: number
  keywords: string[]
}

export type Estacionamiento = {
  id: string
  nombre: string
  direccion: string
  distrito: string
  referencia: string
  lat: number
  lng: number
  activo: boolean
  updatedAt?: string
}

export type ParadaRuta = {
  id: string
  orden: number
  origen: 'venta' | 'manual'
  ventaId: string | null
  ventaCodigo: string
  clienteId: string | null
  clienteNombre: string
  direccion: string
  distrito: string
  zonaNombre: string
  telefono: string
  lat: number
  lng: number
  monto: number
  unidades: number
}

export type TramoRuta = {
  orden: number
  desdeNombre: string
  hastaNombre: string
  desdeLat: number
  desdeLng: number
  hastaLat: number
  hastaLng: number
  distanciaKm: number
  tiempoMin: number
  esRetorno?: boolean
}

export type MetricasRuta = {
  tramos: TramoRuta[]
  distanciaTotalKm: number
  tiempoEstimadoMin: number
  distritosRecorridos: string[]
}

export type RutaGuardada = {
  id: string
  nombre: string
  fecha: string
  almacenId: string | null
  almacenNombre: string
  estacionamientoId: string | null
  estacionamientoNombre: string
  estacionamientoLat: number
  estacionamientoLng: number
  conductorId: string | null
  conductorNombre: string
  vehiculoId: string | null
  vehiculoPlaca: string
  despachoId: string | null
  paradas: ParadaRuta[]
  retornarBase: boolean
  distanciaTotalKm: number
  tiempoEstimadoMin: number
  observaciones: string
  createdAt: string
}

export type FrecuenciaDestino = {
  clave: string
  clienteNombre: string
  direccion: string
  distrito: string
  zonaNombre: string
  repeticiones: number
  rutasCount: number
  ultimaFecha: string
  lat: number
  lng: number
}

export type FrecuenciaDistrito = {
  distrito: string
  zonaNombre: string
  entregas: number
  porcentaje: number
}

export type AnaliticaRepertorio = {
  destinosFrecuentes: FrecuenciaDestino[]
  distritosFrecuentes: FrecuenciaDistrito[]
  totalRutasAnalizadas: number
  totalParadasAnalizadas: number
  destinoTop: FrecuenciaDestino | null
  distritoTop: FrecuenciaDistrito | null
}

export const DISTRITOS_LIMA: DistritoLima[] = [
  {
    nombre: 'Los Olivos',
    zona: 'Lima Norte',
    lat: -11.9918,
    lng: -77.0714,
    keywords: ['los olivos', 'antunez de mayolo', 'angelica gamarra', 'las palmeras', 'izaguirre', 'naranjal', 'maranon', 'covida'],
  },
  {
    nombre: 'San Martín de Porres',
    zona: 'Lima Norte',
    lat: -12.0115,
    lng: -77.0815,
    keywords: ['san martin de porres', 'smp', 'tomas valle', 'habich', 'quilca', 'canta callao', 'zarumilla', 'jose granda', 'universitaria norte'],
  },
  {
    nombre: 'Independencia',
    zona: 'Lima Norte',
    lat: -11.9955,
    lng: -77.0532,
    keywords: ['independencia', 'tahuantinsuyo', 'plaza norte', 'megaplaza', 'panamericana norte', 'pacificO norte'],
  },
  {
    nombre: 'Comas',
    zona: 'Lima Norte',
    lat: -11.9465,
    lng: -77.0558,
    keywords: ['comas', 'belaunde', 'retablo', 'collique', 'la pascana', 'santa luzmila', 'tupac amaru'],
  },
  {
    nombre: 'Carabayllo',
    zona: 'Lima Norte',
    lat: -11.8895,
    lng: -77.0320,
    keywords: ['carabayllo', 'chimpu ocllo', 'el progreso', 'san pedro de carabayllo', 'raul porras'],
  },
  {
    nombre: 'Puente Piedra',
    zona: 'Lima Norte',
    lat: -11.8665,
    lng: -77.0768,
    keywords: ['puente piedra', 'zapallal', 'shangrila', 'chillon'],
  },
  {
    nombre: 'Callao',
    zona: 'Callao',
    lat: -12.0545,
    lng: -77.1290,
    keywords: ['callao', 'saenz pena', 'gambetta', 'aeropuerto', 'puerto del callao', 'faucett', 'argentina callao'],
  },
  {
    nombre: 'Bellavista',
    zona: 'Callao',
    lat: -12.0622,
    lng: -77.1088,
    keywords: ['bellavista', 'ciudad del pescador', 'sabogal', 'mall bellavista', 'colonial bellavista'],
  },
  {
    nombre: 'Ventanilla',
    zona: 'Callao',
    lat: -11.8780,
    lng: -77.1265,
    keywords: ['ventanilla', 'pachacutec', 'mi peru', 'ciudad satelite'],
  },
  {
    nombre: 'Cercado de Lima',
    zona: 'Lima Centro',
    lat: -12.0464,
    lng: -77.0428,
    keywords: ['cercado de lima', 'lima centro', 'abancay', 'nicolas de pierola', 'wilson', 'tacna', 'emancipacion', 'colonial', 'argentina', 'venezuela', 'alfonso ugarte', 'jiron de la union'],
  },
  {
    nombre: 'Breña',
    zona: 'Lima Centro',
    lat: -12.0585,
    lng: -77.0512,
    keywords: ['brena', 'arica', 'tingo maria', 'aguirre'],
  },
  {
    nombre: 'La Victoria',
    zona: 'Lima Centro',
    lat: -12.0672,
    lng: -77.0245,
    keywords: ['la victoria', 'gamarra', 'mexico', 'arriola', 'bausate y meza', 'parinacochas', 'santa catalina', 'canada'],
  },
  {
    nombre: 'Rímac',
    zona: 'Lima Centro',
    lat: -12.0265,
    lng: -77.0345,
    keywords: ['rimac', 'alcazar', 'prolongacion tacna', 'tarapaca', 'amancaes', 'pizarro'],
  },
  {
    nombre: 'San Juan de Lurigancho',
    zona: 'Lima Este',
    lat: -11.9855,
    lng: -76.9990,
    keywords: ['san juan de lurigancho', 'sjl', 'proceres de la independencia', 'wiesse', 'canto grande', 'zarate', 'las flores sjl', 'campoy', 'bayovar'],
  },
  {
    nombre: 'El Agustino',
    zona: 'Lima Este',
    lat: -12.0445,
    lng: -77.0012,
    keywords: ['el agustino', 'riva aguero', 'puente nuevo', 'evitamiento', 'cesar vallejo el agustino'],
  },
  {
    nombre: 'Ate',
    zona: 'Lima Este',
    lat: -12.0278,
    lng: -76.9195,
    keywords: ['ate', 'vitarte', 'puruchuco', 'nicolas ayllon', 'carretera central', 'separadora industrial', 'santa clara', 'salamanca', 'mayorazgo'],
  },
  {
    nombre: 'Santa Anita',
    zona: 'Lima Este',
    lat: -12.0442,
    lng: -76.9708,
    keywords: ['santa anita', 'los ruisenores', 'ovalo santa anita', 'mercado de productores', 'la cultura santa anita'],
  },
  {
    nombre: 'La Molina',
    zona: 'Lima Este',
    lat: -12.0785,
    lng: -76.9422,
    keywords: ['la molina', 'raul ferrero', 'la fontana', 'universidad agraria', 'javier prado este', 'melgarejo', 'camacho', 'rinconada'],
  },
  {
    nombre: 'San Isidro',
    zona: 'Lima Moderna',
    lat: -12.0975,
    lng: -77.0372,
    keywords: ['san isidro', 'canaval y moreyra', 'javier prado oeste', 'pardo y aliaga', 'camino real', 'begonias', 'corpac', 'basadre'],
  },
  {
    nombre: 'Miraflores',
    zona: 'Lima Moderna',
    lat: -12.1211,
    lng: -77.0298,
    keywords: ['miraflores', 'larco', 'jose pardo', 'parque kennedy', 'redondo', 'malecon miraflores', 'armendariz', 'arequipa'],
  },
  {
    nombre: 'Surquillo',
    zona: 'Lima Moderna',
    lat: -12.1112,
    lng: -77.0155,
    keywords: ['surquillo', 'villaran', 'republica de panama', 'angamos este', 'aramburu', 'marsano'],
  },
  {
    nombre: 'San Borja',
    zona: 'Lima Moderna',
    lat: -12.0942,
    lng: -77.0020,
    keywords: ['san borja', 'javier prado', 'las artes', 'san luis', 'rosa toro', 'aviacion'],
  },
  {
    nombre: 'Santiago de Surco',
    zona: 'Lima Moderna',
    lat: -12.1380,
    lng: -76.9895,
    keywords: ['santiago de surco', 'surco', 'primavera', 'benavides', 'higuereta', 'caminos del inca', 'velasco astete', 'jockey', 'chacarilla', 'el polo'],
  },
  {
    nombre: 'Barranco',
    zona: 'Lima Moderna',
    lat: -12.1445,
    lng: -77.0218,
    keywords: ['barranco', 'pedro de osma', 'miguel grau barranco', 'chipoco', 'bolognesi barranco'],
  },
  {
    nombre: 'Chorrillos',
    zona: 'Lima Moderna',
    lat: -12.1745,
    lng: -77.0155,
    keywords: ['chorrillos', 'huaylas', 'guardia civil', 'matellini', 'defensores del morro', 'alipio ponce'],
  },
  {
    nombre: 'San Miguel',
    zona: 'Lima Moderna',
    lat: -12.0772,
    lng: -77.0928,
    keywords: ['san miguel', 'la marina', 'plaza san miguel', 'escobedo', 'bertolotto', 'precursores', 'universitaria', 'costanera'],
  },
  {
    nombre: 'Pueblo Libre',
    zona: 'Lima Moderna',
    lat: -12.0762,
    lng: -77.0642,
    keywords: ['pueblo libre', 'bolivar', 'vivanco', 'cipriano dulanto', 'la mar pueblo libre'],
  },
  {
    nombre: 'Jesús María',
    zona: 'Lima Moderna',
    lat: -12.0755,
    lng: -77.0468,
    keywords: ['jesus maria', 'salaverry', 'garzon', 'horacio urteaga', 'campo de marte', 'san felipe'],
  },
  {
    nombre: 'Lince',
    zona: 'Lima Moderna',
    lat: -12.0842,
    lng: -77.0352,
    keywords: ['lince', 'canevaro', 'petit thouars', 'arenales', 'risso', 'merino'],
  },
  {
    nombre: 'Magdalena del Mar',
    zona: 'Lima Moderna',
    lat: -12.0912,
    lng: -77.0715,
    keywords: ['magdalena del mar', 'magdalena', 'sucre magdalena', 'brasil', 'ejercito'],
  },
  {
    nombre: 'Villa El Salvador',
    zona: 'Lima Sur',
    lat: -12.2128,
    lng: -76.9395,
    keywords: ['villa el salvador', 'parque industrial ves', 'revolucion', 'velasco alvarado', 'el sol ves'],
  },
  {
    nombre: 'Villa María del Triunfo',
    zona: 'Lima Sur',
    lat: -12.1628,
    lng: -76.9385,
    keywords: ['villa maria del triunfo', 'vmt', 'nueva esperanza', 'tablada de lurin', 'san gabriel'],
  },
  {
    nombre: 'San Juan de Miraflores',
    zona: 'Lima Sur',
    lat: -12.1592,
    lng: -76.9698,
    keywords: ['san juan de miraflores', 'sjm', 'los heroes', 'atocongo', 'mall del sur', 'ciudad de dios', 'pamplona'],
  },
  {
    nombre: 'Lurín',
    zona: 'Lima Sur',
    lat: -12.2738,
    lng: -76.8712,
    keywords: ['lurin', 'panamericana sur', 'macropolis', 'km 40', 'antigua panamericana'],
  },
]

export const ESTACIONAMIENTO_BASE_DEFAULT: Estacionamiento = {
  id: 'default-estacionamiento',
  nombre: 'Estacionamiento Base · Flota Lima',
  direccion: 'Av. Antúnez de Mayolo 850, Los Olivos',
  distrito: 'Los Olivos',
  referencia: 'Base operativa principal de salida y retorno de unidades',
  lat: -11.9918,
  lng: -77.0714,
  activo: true,
}

const DISTRITO_FALLBACK = DISTRITOS_LIMA.find(item => item.nombre === 'Cercado de Lima') ?? DISTRITOS_LIMA[0]

export function normalizarTextoGeo(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hashCadena(texto: string): number {
  let hash = 2166136261
  for (let i = 0; i < texto.length; i += 1) {
    hash ^= texto.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6))
}

function contieneKeyword(haystack: string, keyword: string): boolean {
  const kw = normalizarTextoGeo(keyword)
  if (!kw || !haystack) return false
  return ` ${haystack} `.includes(` ${kw} `)
}

export function buscarDistritoPorNombre(nombre?: string): DistritoLima | undefined {
  const target = normalizarTextoGeo(nombre ?? '')
  if (!target) return undefined
  return DISTRITOS_LIMA.find(item => normalizarTextoGeo(item.nombre) === target)
}

export function resolverUbicacionParada(input: {
  direccion?: string
  zonaNombre?: string
  clienteNombre?: string
  distrito?: string
  semilla?: string
}): { distrito: string; zonaNombre: string; lat: number; lng: number } {
  const explicito = buscarDistritoPorNombre(input.distrito)
  const textoBusqueda = normalizarTextoGeo([input.distrito, input.direccion, input.zonaNombre].filter(Boolean).join(' '))

  let encontrado: DistritoLima | undefined = explicito
  let mejorLongitud = explicito ? explicito.nombre.length : -1

  if (!encontrado && textoBusqueda) {
    // 1) Prioriza coincidencia explícita con el nombre del distrito antes que keywords de vías compartidas.
    for (const distrito of DISTRITOS_LIMA) {
      const nombreNorm = normalizarTextoGeo(distrito.nombre)
      if (contieneKeyword(textoBusqueda, nombreNorm) && nombreNorm.length > mejorLongitud) {
        encontrado = distrito
        mejorLongitud = nombreNorm.length
      }
    }
    // 2) Si ningún nombre de distrito apareció, infiere por avenidas o puntos clave.
    if (!encontrado) {
      for (const distrito of DISTRITOS_LIMA) {
        for (const kw of distrito.keywords) {
          const kwNorm = normalizarTextoGeo(kw)
          if (contieneKeyword(textoBusqueda, kwNorm) && kwNorm.length > mejorLongitud) {
            encontrado = distrito
            mejorLongitud = kwNorm.length
          }
        }
      }
    }
  }

  const base = encontrado ?? DISTRITO_FALLBACK
  const semilla = `${input.direccion ?? ''}|${input.clienteNombre ?? ''}|${input.semilla ?? base.nombre}`
  const h1 = hashCadena(semilla)
  const h2 = hashCadena(`lng:${semilla}`)
  const latOffset = ((h1 % 901) - 450) / 100000 // ±0.0045 deg (~500 m)
  const lngOffset = ((h2 % 901) - 450) / 100000

  return {
    distrito: encontrado ? encontrado.nombre : (input.distrito?.trim() || 'Lima Centro'),
    zonaNombre: input.zonaNombre?.trim() || base.zona,
    lat: roundCoord(base.lat + latOffset),
    lng: roundCoord(base.lng + lngOffset),
  }
}

export function distanciaTramoKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const rectilineoKm = 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
  const urbanoKm = rectilineoKm * 1.28
  return Number(urbanoKm.toFixed(2))
}

export function calcularMetricasRuta(
  estacionamiento: Pick<Estacionamiento, 'nombre' | 'lat' | 'lng'>,
  paradas: ParadaRuta[],
  retornarBase = false,
): MetricasRuta {
  if (!paradas.length) {
    return {
      tramos: [],
      distanciaTotalKm: 0,
      tiempoEstimadoMin: 0,
      distritosRecorridos: [],
    }
  }

  const tramos: TramoRuta[] = []
  let prevNombre = estacionamiento.nombre || 'Estacionamiento base'
  let prevLat = estacionamiento.lat
  let prevLng = estacionamiento.lng
  const distritosRecorridos: string[] = []

  paradas.forEach((parada, idx) => {
    const km = distanciaTramoKm({ lat: prevLat, lng: prevLng }, { lat: parada.lat, lng: parada.lng })
    const tiempoMin = Math.max(4, Math.round((km / 24) * 60) + 8)
    tramos.push({
      orden: idx + 1,
      desdeNombre: prevNombre,
      hastaNombre: `${parada.orden}. ${parada.clienteNombre}`,
      desdeLat: prevLat,
      desdeLng: prevLng,
      hastaLat: parada.lat,
      hastaLng: parada.lng,
      distanciaKm: km,
      tiempoMin,
    })
    prevNombre = `${parada.orden}. ${parada.clienteNombre}`
    prevLat = parada.lat
    prevLng = parada.lng
    const distritoLabel = parada.distrito.trim() || parada.zonaNombre.trim()
    if (distritoLabel && !distritosRecorridos.includes(distritoLabel)) {
      distritosRecorridos.push(distritoLabel)
    }
  })

  if (retornarBase) {
    const ultima = paradas[paradas.length - 1]
    const kmRetorno = distanciaTramoKm(
      { lat: ultima.lat, lng: ultima.lng },
      { lat: estacionamiento.lat, lng: estacionamiento.lng },
    )
    const minRetorno = Math.max(4, Math.round((kmRetorno / 24) * 60))
    tramos.push({
      orden: paradas.length + 1,
      desdeNombre: `${ultima.orden}. ${ultima.clienteNombre}`,
      hastaNombre: `${estacionamiento.nombre || 'Estacionamiento base'} (retorno)`,
      desdeLat: ultima.lat,
      desdeLng: ultima.lng,
      hastaLat: estacionamiento.lat,
      hastaLng: estacionamiento.lng,
      distanciaKm: kmRetorno,
      tiempoMin: minRetorno,
      esRetorno: true,
    })
  }

  const distanciaTotalKm = Number(tramos.reduce((acc, item) => acc + item.distanciaKm, 0).toFixed(2))
  const tiempoEstimadoMin = tramos.reduce((acc, item) => acc + item.tiempoMin, 0)

  return {
    tramos,
    distanciaTotalKm,
    tiempoEstimadoMin,
    distritosRecorridos,
  }
}

export function optimizarParadasPorCercania(
  estacionamiento: Pick<Estacionamiento, 'lat' | 'lng'>,
  paradas: ParadaRuta[],
): ParadaRuta[] {
  if (paradas.length <= 1) {
    return paradas.map((item, idx) => ({ ...item, orden: idx + 1 }))
  }

  const pendientes = [...paradas]
  const ordenadas: ParadaRuta[] = []
  let actual = { lat: estacionamiento.lat, lng: estacionamiento.lng }

  while (pendientes.length > 0) {
    let mejorIdx = 0
    let mejorDistancia = Infinity
    for (let i = 0; i < pendientes.length; i += 1) {
      const dist = distanciaTramoKm(actual, pendientes[i])
      if (dist < mejorDistancia) {
        mejorDistancia = dist
        mejorIdx = i
      }
    }
    const elegida = pendientes.splice(mejorIdx, 1)[0]
    ordenadas.push({ ...elegida, orden: ordenadas.length + 1 })
    actual = { lat: elegida.lat, lng: elegida.lng }
  }

  return ordenadas
}

type ParadaObservada = {
  rutaKey: string
  fecha: string
  clienteId: string | null
  clienteNombre: string
  direccion: string
  distrito: string
  zonaNombre: string
  lat: number
  lng: number
}

export function construirAnaliticaRepertorio(
  rutas: RutaGuardada[],
  despachos: Despacho[] = [],
): AnaliticaRepertorio {
  const despachosEnRutas = new Set(
    rutas.map(item => item.despachoId).filter((id): id is string => Boolean(id)),
  )

  const observaciones: ParadaObservada[] = []
  let totalRutasAnalizadas = 0

  for (const ruta of rutas) {
    if (!ruta.paradas.length) continue
    totalRutasAnalizadas += 1
    for (const parada of ruta.paradas) {
      observaciones.push({
        rutaKey: `ruta:${ruta.id}`,
        fecha: ruta.fecha || ruta.createdAt.slice(0, 10),
        clienteId: parada.clienteId,
        clienteNombre: parada.clienteNombre,
        direccion: parada.direccion,
        distrito: parada.distrito,
        zonaNombre: parada.zonaNombre,
        lat: parada.lat,
        lng: parada.lng,
      })
    }
  }

  for (const despacho of despachos) {
    if (despacho.estado === 'cancelado' || despachosEnRutas.has(despacho.id) || !despacho.paradas.length) {
      continue
    }
    totalRutasAnalizadas += 1
    for (const parada of despacho.paradas) {
      const geo = resolverUbicacionParada({
        direccion: parada.direccion,
        zonaNombre: parada.zonaNombre,
        clienteNombre: parada.clienteNombre,
        semilla: parada.ventaCodigo || parada.id,
      })
      observaciones.push({
        rutaKey: `despacho:${despacho.id}`,
        fecha: despacho.fecha,
        clienteId: parada.clienteId,
        clienteNombre: parada.clienteNombre,
        direccion: parada.direccion,
        distrito: geo.distrito,
        zonaNombre: geo.zonaNombre,
        lat: geo.lat,
        lng: geo.lng,
      })
    }
  }

  const porDestino = new Map<string, FrecuenciaDestino & { rutasSet: Set<string> }>()
  const porDistrito = new Map<string, { distrito: string; zonaNombre: string; entregas: number }>()

  for (const obs of observaciones) {
    const clienteKey = obs.clienteId || normalizarTextoGeo(obs.clienteNombre) || 'destino'
    const dirKey = normalizarTextoGeo(obs.direccion) || normalizarTextoGeo(obs.distrito) || 'sin-direccion'
    const clave = `${clienteKey}|${dirKey}`
    const actual = porDestino.get(clave)

    if (actual) {
      actual.repeticiones += 1
      actual.rutasSet.add(obs.rutaKey)
      actual.rutasCount = actual.rutasSet.size
      if (obs.fecha > actual.ultimaFecha) actual.ultimaFecha = obs.fecha
      if (obs.direccion && !actual.direccion) actual.direccion = obs.direccion
    } else {
      const rutasSet = new Set([obs.rutaKey])
      porDestino.set(clave, {
        clave,
        clienteNombre: obs.clienteNombre,
        direccion: obs.direccion || obs.distrito,
        distrito: obs.distrito,
        zonaNombre: obs.zonaNombre,
        repeticiones: 1,
        rutasCount: 1,
        ultimaFecha: obs.fecha,
        lat: obs.lat,
        lng: obs.lng,
        rutasSet,
      })
    }

    const distritoLabel = obs.distrito.trim() || obs.zonaNombre.trim() || 'Sin distrito'
    const distActual = porDistrito.get(distritoLabel)
    if (distActual) {
      distActual.entregas += 1
    } else {
      porDistrito.set(distritoLabel, {
        distrito: distritoLabel,
        zonaNombre: obs.zonaNombre || 'Lima',
        entregas: 1,
      })
    }
  }

  const destinosFrecuentes: FrecuenciaDestino[] = Array.from(porDestino.values())
    .map(({ rutasSet: _set, ...resto }) => resto)
    .sort((a, b) => b.repeticiones - a.repeticiones || b.ultimaFecha.localeCompare(a.ultimaFecha) || a.clienteNombre.localeCompare(b.clienteNombre, 'es'))

  const totalParadasAnalizadas = observaciones.length
  const distritosFrecuentes: FrecuenciaDistrito[] = Array.from(porDistrito.values())
    .map(item => ({
      ...item,
      porcentaje: totalParadasAnalizadas > 0 ? Math.round((item.entregas / totalParadasAnalizadas) * 100) : 0,
    }))
    .sort((a, b) => b.entregas - a.entregas || a.distrito.localeCompare(b.distrito, 'es'))

  return {
    destinosFrecuentes,
    distritosFrecuentes,
    totalRutasAnalizadas,
    totalParadasAnalizadas,
    destinoTop: destinosFrecuentes[0] ?? null,
    distritoTop: distritosFrecuentes[0] ?? null,
  }
}
