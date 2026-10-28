export type AnalyzerSourceKind = 'zip' | 'enlace'

export type AnalyzerArea = 'Seguridad' | 'Escalabilidad'

export type AnalyzerSeverity = 'Critica' | 'Alta' | 'Media' | 'Info'

export type AnalyzerFile = { path: string; bytes: number; text?: string }

export type AnalyzerFinding = {
  id: string
  area: AnalyzerArea
  severity: AnalyzerSeverity
  title: string
  detail: string
  files: string[]
  recommendation: string
}

export type AwsRecommendation = {
  service: string
  category: string
  priority: 'Principal' | 'Complementario' | 'Opcional'
  reason: string
  signals: string[]
}

export type AnalyzerStats = {
  files: number
  bytes: number
  languages: string[]
}

export type AnalyzerScores = {
  security: number
  scalability: number
  cloudReadiness: number
  total: number
}

export type AnalyzerReport = {
  name: string
  source: { kind: AnalyzerSourceKind; origin: string }
  generatedAt: string
  stats: AnalyzerStats
  stack: string[]
  findings: AnalyzerFinding[]
  awsRecommendations: AwsRecommendation[]
  recommendationsVersion?: number
  scores: AnalyzerScores
}

type FileRule = {
  id: string
  area: AnalyzerArea
  severity: AnalyzerSeverity
  title: string
  detail: string
  recommendation: string
  test: (file: AnalyzerFile) => boolean
}

type Accumulated = {
  finding: Omit<AnalyzerFinding, 'files'>
  files: Set<string>
}

const CLAMP = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

const FILES_PER_FINDING = 6

const SEVERITY_WEIGHT: Record<AnalyzerSeverity, number> = { Critica: 30, Alta: 18, Media: 9, Info: 3 }

const SEVERITY_ORDER: Record<AnalyzerSeverity, number> = { Critica: 0, Alta: 1, Media: 2, Info: 3 }

const FILE_RULES: FileRule[] = [
  {
    id: 'S-AWS-CREDENCIAL',
    area: 'Seguridad',
    severity: 'Critica',
    title: 'Credenciales de AWS escritas en el código',
    detail: 'Aparece una clave de acceso de AWS (AKIA/ASIA) grabada en un archivo del proyecto: cualquiera con el paquete puede usarla.',
    recommendation: 'Rota la credencial en AWS IAM, retírala del código y consúmela por variables de entorno o Secrets Manager.',
    test: file => /(?:AKIA|ASIA)[0-9A-Z]{16}/.test(file.text ?? ''),
  },
  {
    id: 'S-CLAVE-PRIVADA',
    area: 'Seguridad',
    severity: 'Critica',
    title: 'Clave privada dentro del proyecto',
    detail: 'Se detecta un bloque de clave privada (BEGIN PRIVATE KEY) guardado junto al código fuente.',
    recommendation: 'Saca la clave del repositorio, guárdala en un gestor de secretos y rota la expuesta.',
    test: file => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(file.text ?? ''),
  },
  {
    id: 'S-ENV-INCLUIDO',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Archivo .env incluido en el análisis',
    detail: 'El paquete trae un archivo .env real; publicarlo junto al código expone credenciales y parámetros privados.',
    recommendation: 'Agrega .env al .gitignore, sube solo plantillas (.env.example) y rota las claves que viajaron en él.',
    test: file => /(?:^|\/)\.env$/.test(file.path),
  },
  {
    id: 'S-GIT-INCLUIDO',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Carpeta .git dentro del paquete',
    detail: 'El paquete incluye el historial de Git: quien lo reciba puede reconstruir versiones viejas y secretos borrados.',
    recommendation: 'Comprime el proyecto limpio (sin .git) o comparte el acceso al repositorio con permisos.',
    test: file => /(?:^|\/)\.git\//.test(file.path),
  },
  {
    id: 'S-CADENA-CONTRA',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Cadena de conexión con contraseña visible',
    detail: 'Una cadena de conexión (postgres, mysql, mongodb u otros) contiene usuario y contraseña dentro del código.',
    recommendation: 'Mueve la conexión a variables de entorno o a un gestor de secretos y rota la contraseña expuesta.',
    test: file => /["'](?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/[^"'@\s\n]{1,120}:[^"'@\s\n]{3,}@/.test(file.text ?? ''),
  },
  {
    id: 'S-SECRETO-CODIGO',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Secreto o API key fijado en el código',
    detail: 'Hay una asignación literal de clave o secreto (api_key, secret, password, token) en el fuente.',
    recommendation: 'Reemplaza los valores fijos por variables de entorno y rota la clave comprometida.',
    test: file => /\b(?:api[_-]?key|secret|passwd|password|token)\b['"]?\s*[:=]\s*(['"])(?!\$\{)[^"'\n]{12,}\1/i.test(file.text ?? ''),
  },
  {
    id: 'S-TLS-BYPASS',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Comprobación de certificados deshabilitada',
    detail: 'El código desactiva la verificación TLS (rejectUnauthorized false, verify=False o InsecureSkipVerify true).',
    recommendation: 'Elimina la opción; en desarrollo usa certificados propios válidos.',
    test: file => /rejectUnauthorized['"]?\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"0]|InsecureSkipVerify\s*:\s*true|verify\s*=\s*False/.test(file.text ?? ''),
  },
  {
    id: 'S-SQL-INTERPOLADO',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Consultas SQL construidas con valores concatenados',
    detail: 'Se forma una consulta SQL interpolando variables en el texto, patrón clásico de inyección SQL.',
    recommendation: 'Usa consultas parametrizadas u ORM con placeholders ($1, ?) y elimina la concatenación.',
    test: file => /(?:f["'](?:SELECT|INSERT|UPDATE|DELETE)[^"']{0,200}\{)|(?:["'`][^"`]{0,240}\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b[^"`]{0,240}\$\{)|(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[\s\S]{0,220}?\+[\s\S]{0,120}?\)/i.test(file.text ?? ''),
  },
  {
    id: 'S-EVAL-DINAMICO',
    area: 'Seguridad',
    severity: 'Alta',
    title: 'Ejecución de código dinámico (eval / shell)',
    detail: 'Se ejecuta texto como código (eval, new Function, os.system o shell=True); un atacante podría inyectar comandos.',
    recommendation: 'Elimina la ejecución dinámica o valida cualquier entrada contra listas de permitidos.',
    test: file => /\beval\s*\(|new\s+Function\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen)\([^\n]{0,120}shell\s*=\s*True/.test(file.text ?? ''),
  },
  {
    id: 'S-CORS-ABIERTO',
    area: 'Seguridad',
    severity: 'Media',
    title: 'CORS abierto a cualquier origen',
    detail: 'La API responde con origin "*": cualquier sitio puede consumirla e incluso usar cookies de sesión.',
    recommendation: 'Configura cors con la lista real de orígenes y no respondas siempre con *.',
    test: file => /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/.test(file.text ?? ''),
  },
  {
    id: 'S-HASH-DEBIL',
    area: 'Seguridad',
    severity: 'Media',
    title: 'Hash débil (MD5/SHA-1) aplicado a credenciales',
    detail: 'Se usa MD5 o SHA-1 generando hash de contraseñas o token; son algoritmos rompibles hoy.',
    recommendation: 'Usa bcrypt o argon2 para contraseñas y SHA-256 o superior para integridad.',
    test: file => /\b(md5|sha1)\b[^\n]{0,90}(?:pass|token|hash|secret)/i.test(file.text ?? ''),
  },
  {
    id: 'S-DEBUG-PRODUCCION',
    area: 'Seguridad',
    severity: 'Media',
    title: 'Depuración activa en producción',
    detail: 'Se detecta DEBUG=True o modo development con trazas que pueden filtrar información interna.',
    recommendation: 'Desactiva el modo de depuración en producción y centraliza los errores en registro controlado.',
    test: file => /\bDEBUG\s*=\s*True\b|NODE_ENV['"]?\s*[:=]\s*['"]?development['"]?/i.test(file.text ?? ''),
  },
  {
    id: 'E-FS-SYNC',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Operaciones de archivos sincrónicas',
    detail: 'El servidor usa fs.readFileSync/writeFileSync: bloquea el hilo de eventos y reduce la concurrencia.',
    recommendation: 'Migra a las versiones promise de fs o streams; bajo carga la latencia se degrada en bloque.',
    test: file => /\bfs\.readFileSync\b|\bfs\.writeFileSync\b/.test(file.text ?? ''),
  },
  {
    id: 'E-SQLITE-LOCAL',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Base de datos en archivo local (SQLite)',
    detail: 'El proyecto usa SQLite sobre disco local: dos instancias del servicio no comparten datos.',
    recommendation: 'Migra a un motor administrado (RDS/Aurora, Postgres en Supabase) para escalar horizontalmente.',
    test: file => /(?:sqlite3?|better-sqlite3)['"]|\.sqlite['"]/.test(file.text ?? ''),
  },
  {
    id: 'E-SUBIDA-LOCAL',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Archivos subidos al disco del servidor',
    detail: 'Multer o código propio guarda archivos en el disco de la instancia; al escalar otros nodos no los verían.',
    recommendation: 'Sube a Amazon S3 (o equivalente) con URLs firmadas y guarda solo la referencia en la BD.',
    test: file => /multer[^;\n]{0,90}dest(?:ination)?\s*[:=]\s*['"][^'";\n]+['"]|fs\.createWriteStream/.test(file.text ?? ''),
  },
  {
    id: 'E-SELECT-SIN-PAGINAR',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Consultas SELECT sin límite de resultados',
    detail: 'Se listan tablas completas sin LIMIT: la memoria y la latencia crecen con cada fila nueva.',
    recommendation: 'Pagina las consultas (LIMIT/OFFSET o paginación del ORM) y usa índices con los filtros.',
    test: file => (file.text ?? '').split(/\r?\n/).some(line => /select\b/i.test(line) && /\bfrom\b/i.test(line) && !/\blimit\b|\boffset\b|\btop\b|\bpagination\b/i.test(line)),
  },
  {
    id: 'E-CONSULTA-BUCLE',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Consultas de base de datos dentro de bucles (N+1)',
    detail: 'Hay un bucle con operación de BD dentro: una ida y vuelta por elemento satura la conexión.',
    recommendation: 'Consolida con IN, batch insert, JOIN o loaders del ORM en lugar de consultar por registro.',
    test: file => /for\s*(?:await)?\s*\([^)]{0,80}\)\s*\{[\s\S]{0,240}?\b(?:await\s+(?:db|pool|client|prisma|knex|axios|fetch|supabase)|\.query\s*\()/i.test(file.text ?? ''),
  },
  {
    id: 'E-DEPENDENCIAS-PAQUETE',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Dependencias instaladas dentro del paquete',
    detail: 'El ZIP incluye node_modules, .venv o __pycache__: infla el tamaño y puede arrastrar binarios de otra máquina.',
    recommendation: 'Comprime el proyecto limpio; cada entorno instala dependencias desde package.json o requirements.',
    test: file => /(?:^|\/)(?:node_modules|\.venv|__pycache__)\//.test(file.path),
  },
  {
    id: 'E-SOCKET-MEMORIA',
    area: 'Escalabilidad',
    severity: 'Media',
    title: 'Tiempo real sin adaptador de escalado',
    detail: 'Sockets gestionados en memoria local; con más de una instancia los clientes pierden mensajes.',
    recommendation: 'Configura el adaptador Redis de Socket.IO o un servicio gestionado si habrá réplicas.',
    test: file => /socket\.io/.test(file.text ?? ''),
  },
]

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rb: 'Ruby', go: 'Go', java: 'Java', kt: 'Kotlin', swift: 'Swift', php: 'PHP', cs: 'C#',
  c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', rs: 'Rust', scala: 'Scala', dart: 'Dart', lua: 'Lua',
  sh: 'Shell', bash: 'Shell', sql: 'SQL', pl: 'Perl', r: 'R', ipynb: 'Jupyter',
}

const FILE_NAME_LANGUAGES: Array<[RegExp, string]> = [
  [/^(?:dockerfile|docker-compose\.ya?ml)$/i, 'Docker'],
  [/^(?:makefile|procfile)$/i, 'Build / procesos'],
  [/^go\.mod$/i, 'Go'],
  [/^cargo\.toml$/i, 'Rust'],
  [/^gemfile$/i, 'Ruby'],
  [/^composer\.json$/i, 'PHP'],
  [/^(?:pom\.xml|build\.gradle)/i, 'Java'],
  [/^(?:requirements[\w.-]*\.txt|pyproject\.toml)$/i, 'Python'],
  [/^(?:serverless\.ya?ml|template\.ya?ml|samconfig\.toml)$/i, 'AWS SAM / Serverless'],
  [/^(?:vite\.config|next\.config|tsconfig|jest\.config|vitest\.config|tailwind\.config)/i, 'Tooling'],
]

const JS_STACK_HINTS: Array<[RegExp, string]> = [
  [/^next(?:\/|$)/, 'Next.js'],
  [/^react(?:\/|-dom)?$/, 'React'],
  [/^vue(?:\/|$)/, 'Vue'],
  [/^svelte(?:\/|$)/, 'Svelte'],
  [/^@angular\//, 'Angular'],
  [/^vite$/, 'Vite'],
  [/^express$/, 'Express'],
  [/^@nestjs\//, 'NestJS'],
  [/^fastify/, 'Fastify'],
  [/^koa$/, 'Koa'],
  [/^socket\.io(?:-client)?$/, 'Socket.IO'],
  [/^redis(?:\.|$)/, 'Redis'],
  [/^@prisma\/|^prisma$/, 'Prisma ORM'],
  [/^typeorm$/, 'TypeORM'],
  [/^drizzle/, 'Drizzle ORM'],
  [/^knex$/, 'Knex'],
  [/^pg$|^postgres(?:\.js)?$/, 'PostgreSQL'],
  [/^mysql/, 'MySQL'],
  [/^mongoose$|^mongodb/, 'MongoDB'],
  [/^@aws-sdk\//, 'AWS SDK v3'],
  [/^aws-sdk$/, 'AWS SDK v2'],
  [/^@?aws-amplify/, 'AWS Amplify'],
  [/^@supabase\//, 'Supabase'],
]

const PY_STACK_HINTS: Array<[RegExp, string]> = [
  [/flask/i, 'Flask'],
  [/django/i, 'Django'],
  [/fastapi/i, 'FastAPI'],
  [/boto3|aws[^a-z]/i, 'AWS SDK Python (boto3)'],
  [/sqlalchemy/i, 'SQLAlchemy'],
  [/uvicorn|gunicorn/i, 'Servidor ASGI/WSGI'],
]

export function severityTone(severity: AnalyzerSeverity): 'red' | 'amber' | 'blue' | 'green' {
  if (severity === 'Critica') return 'red'
  if (severity === 'Alta') return 'amber'
  if (severity === 'Media') return 'blue'
  return 'green'
}

export function scoreTone(score: number): 'green' | 'amber' | 'red' {
  if (score >= 80) return 'green'
  if (score >= 55) return 'amber'
  return 'red'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function languageOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const extension = name.includes('.') ? name.split('.').pop()?.toLocaleLowerCase('en') ?? '' : ''
  if (LANGUAGE_BY_EXT[extension]) return LANGUAGE_BY_EXT[extension]
  for (const [pattern, language] of FILE_NAME_LANGUAGES) if (pattern.test(name)) return language
  return ''
}

function dependenciesFromPackageJson(files: AnalyzerFile[]): string[] {
  const packageJson = files.find(file => /(?:^|\/)package\.json$/.test(file.path) && file.text)
  if (!packageJson?.text) return []
  const dependencies = new Set<string>()
  for (const section of ['dependencies', 'devDependencies']) {
    const block = new RegExp(`"${section}"\\s*:\\s*\\{([\\s\\S]{0,4000}?)\\}`, 'i').exec(packageJson.text)
    if (!block) continue
    for (const match of block[1].matchAll(/"([^"]+)"\s*:/g)) dependencies.add(match[1].toLocaleLowerCase('en'))
  }
  return [...dependencies]
}

function pythonDependencies(files: AnalyzerFile[]): string[] {
  const dependencies: string[] = []
  const sources = files.filter(file => /(?:^|\/)(?:requirements[\w.-]*\.txt|pyproject\.toml)$/.test(file.path) && file.text)
  for (const file of sources) {
    for (const raw of (file.text ?? '').split(/\r?\n/)) {
      const name = raw.trim().replace(/^["'[\]\s]+|["'\],\s]+$/g, '').replace(/[><=!~;\s].*$/, '').toLocaleLowerCase('en')
      if (name && /^[a-z][\w.-]*$/.test(name)) dependencies.push(name)
    }
  }
  return [...new Set(dependencies)]
}

function detectStack(files: AnalyzerFile[]): string[] {
  const stack = new Set<string>()
  const counted = new Set<string>()
  for (const file of files) {
    const language = languageOf(file.path)
    if (!language || ['Tooling', 'Build / procesos', 'AWS SAM / Serverless'].includes(language)) continue
    if (!counted.has(language)) {
      counted.add(language)
      stack.add(language)
    }
  }
  const js = dependenciesFromPackageJson(files)
  const py = pythonDependencies(files)
  for (const [pattern, name] of JS_STACK_HINTS) if (js.some(dep => pattern.test(dep))) stack.add(name)
  for (const [pattern, name] of PY_STACK_HINTS) if (py.some(dep => pattern.test(dep))) stack.add(name)
  if (files.some(file => file.path.endsWith('.csproj'))) stack.add('.NET')
  return [...stack]
}

function recommendAwsServices(
  files: AnalyzerFile[],
  stack: string[],
  context: { hasDocker: boolean; hasIac: boolean; hasCi: boolean },
): AwsRecommendation[] {
  const recommendations: AwsRecommendation[] = []
  const add = (recommendation: AwsRecommendation) => {
    if (!recommendations.some(item => item.service === recommendation.service)) recommendations.push(recommendation)
  }
  const pathsMatching = (pattern: RegExp) => files
    .filter(file => pattern.test(file.path) || pattern.test(file.text ?? ''))
    .slice(0, 4)
    .map(file => file.path)
  const frontend = stack.filter(item => ['React', 'Vue', 'Svelte', 'Angular', 'Vite', 'Next.js'].includes(item))
  const backend = stack.filter(item => ['Express', 'Fastify', 'Koa', 'NestJS', 'Flask', 'Django', 'FastAPI', '.NET'].includes(item))
  const apiFiles = pathsMatching(/(?:^|\/)(?:api|backend|server)\/|\b(?:app|router)\.(?:get|post|put|delete|patch)\s*\(|\b(?:FastAPI|Flask|express\s*\(|NestFactory)\b/i)
  const isServerless = files.some(file => /(?:^|\/)(?:serverless\.ya?ml|samconfig\.toml)$/.test(file.path) || /AWS::Serverless::Function/.test(file.text ?? ''))
  const hasBackend = backend.length > 0 || apiFiles.length > 0 || isServerless
  const signals = (...values: Array<string | undefined>) => values.filter((value): value is string => Boolean(value))

  if (frontend.length > 0) {
    const next = frontend.includes('Next.js')
    add({
      service: next ? 'AWS Amplify Hosting' : 'Amazon S3 + Amazon CloudFront',
      category: next ? 'Hosting de aplicaciones web' : 'Hosting web estático y CDN',
      priority: 'Principal',
      reason: next
        ? 'El stack incluye Next.js; Amplify Hosting es una opción para publicar la aplicación web y sus rutas renderizadas.'
        : 'El stack incluye una interfaz web. S3 puede servir los archivos estáticos y CloudFront distribuirlos con baja latencia.',
      signals: signals(...frontend, ...pathsMatching(/(?:^|\/)(?:vite\.config|next\.config|index\.html|src\/.*\.(?:tsx|jsx|vue|svelte))$/i)),
    })
  }

  if (hasBackend) {
    const backendSignals = signals(...backend, ...apiFiles, context.hasDocker ? 'Dockerfile / docker-compose' : undefined)
    if (isServerless) {
      add({
        service: 'AWS Lambda + Amazon API Gateway',
        category: 'API sin servidor',
        priority: 'Principal',
        reason: 'El proyecto ya describe funciones serverless; Lambda ejecuta la lógica y API Gateway puede exponer los endpoints.',
        signals: signals(...backendSignals, ...pathsMatching(/serverless\.ya?ml|samconfig\.toml|template\.ya?ml/i)),
      })
    } else if (context.hasDocker) {
      add({
        service: 'Amazon ECS con AWS Fargate',
        category: 'Ejecución de contenedores',
        priority: 'Principal',
        reason: 'El proyecto ya incluye configuración de contenedor; Fargate permite ejecutar el servicio sin administrar servidores. Amazon ECR puede guardar las imágenes.',
        signals: backendSignals,
      })
    } else {
      add({
        service: 'Amazon ECS Express Mode + Amazon ECR',
        category: 'Publicación administrada de API o servicio web',
        priority: 'Principal',
        reason: 'Se identificó un framework o rutas de servidor. ECS Express Mode administra la publicación del servicio; como el proyecto no incluye contenedor, primero habrá que preparar una imagen y guardarla en ECR.',
        signals: backendSignals,
      })
    }
    add({
      service: 'Amazon CloudWatch',
      category: 'Registros y monitoreo',
      priority: 'Complementario',
      reason: 'Centraliza registros y métricas del servicio desplegado para investigar errores y vigilar su operación.',
      signals: backendSignals,
    })
  }

  const supabase = stack.includes('Supabase') || files.some(file => /@supabase\/|supabase\.co/i.test(file.text ?? ''))
  const postgres = stack.includes('PostgreSQL') || files.some(file => /postgres(?:ql)?:\/\//i.test(file.text ?? ''))
  const mysql = stack.includes('MySQL') || files.some(file => /mysql:\/\//i.test(file.text ?? ''))
  if (postgres || mysql) {
    const engine = postgres ? 'PostgreSQL' : 'MySQL'
    add({
      service: `Amazon RDS para ${engine}`,
      category: 'Base de datos relacional administrada',
      priority: supabase ? 'Opcional' : 'Complementario',
      reason: supabase
        ? 'El stack ya incluye Supabase/PostgreSQL. Mantén la base actual si cubre las necesidades; considera RDS solo si se decide consolidar también la base de datos en AWS.'
        : `Se encontró evidencia de ${engine}. RDS puede alojar una base relacional administrada si ese motor forma parte del despliegue previsto.`,
      signals: signals(...(postgres ? ['PostgreSQL'] : ['MySQL']), ...(supabase ? ['Supabase detectado; migración no necesaria por defecto'] : []), ...pathsMatching(/(?:database|db|supabase|\.env)/i)),
    })
  }

  const s3ClientFiles = pathsMatching(/@aws-sdk\/client-s3|\bS3Client\b|\b(?:PutObject|GetObject|DeleteObject)Command\b|\bs3:\/\//i)
  const uploadFiles = pathsMatching(/multer[^\n]{0,100}dest(?:ination)?\s*[:=]\s*['"][^'";\n]+['"]|fs\.createWriteStream|upload\.single\s*\(/i)
  const s3Signals = [...new Set([...s3ClientFiles, ...uploadFiles])]
  if (s3Signals.length > 0) {
    add({
      service: 'Amazon S3',
      category: 'Almacenamiento de archivos',
      priority: s3ClientFiles.length > 0 ? 'Complementario' : 'Principal',
      reason: s3ClientFiles.length > 0
        ? 'Se detectó integración con el cliente de Amazon S3. Revisa permisos IAM mínimos, cifrado, acceso privado y URLs temporales para los objetos.'
        : 'Se encontró manejo de archivos en el servidor. S3 permite guardar los objetos fuera del disco local de la aplicación y compartirlos entre instancias.',
      signals: s3Signals,
    })
  }

  const secretFiles = pathsMatching(/(?:^|\/)\.env(?:\.|$)|process\.env|import\.meta\.env|os\.environ|os\.getenv/i)
  if (hasBackend && secretFiles.length > 0) {
    add({
      service: 'AWS Secrets Manager',
      category: 'Gestión de secretos',
      priority: 'Complementario',
      reason: 'La aplicación usa configuración de entorno. Para el despliegue, guarda credenciales del servidor en un gestor de secretos y evita incluirlas en el repositorio o el cliente web.',
      signals: secretFiles,
    })
  }

  if (!context.hasCi && (frontend.length > 0 || hasBackend)) {
    add({
      service: 'AWS CodeBuild + AWS CodePipeline',
      category: 'Integración y despliegue continuo',
      priority: 'Opcional',
      reason: 'No se encontró un flujo CI visible. Estos servicios pueden automatizar compilación, validaciones y despliegue cuando se elija AWS como destino.',
      signals: ['No se detectó configuración CI en GitHub Actions, GitLab CI, Bitbucket o CircleCI'],
    })
  }

  if (!context.hasIac && hasBackend) {
    add({
      service: 'AWS CDK o AWS CloudFormation',
      category: 'Infraestructura como código',
      priority: 'Opcional',
      reason: 'No se encontró infraestructura como código. Definir recursos de AWS en plantillas facilita repetir y revisar el despliegue.',
      signals: signals(...backend, ...apiFiles, 'No se detectó plantilla de infraestructura'),
    })
  }

  return recommendations
}

export function buildAnalysisFromFiles(
  name: string,
  kind: AnalyzerSourceKind,
  origin: string,
  files: AnalyzerFile[],
): AnalyzerReport {
  const stats: AnalyzerStats = {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    languages: [],
  }
  const byLanguage = new Map<string, number>()
  for (const file of files) {
    const language = languageOf(file.path)
    if (!language) continue
    byLanguage.set(language, (byLanguage.get(language) ?? 0) + file.bytes + 1)
  }
  stats.languages = [...byLanguage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([language]) => language)
  const stack = detectStack(files)

  const accumulated = new Map<string, Accumulated>()
  const add = (rule: FileRule, file: AnalyzerFile) => {
    let entry = accumulated.get(rule.id)
    if (!entry) {
      entry = {
        finding: { id: rule.id, area: rule.area, severity: rule.severity, title: rule.title, detail: rule.detail, recommendation: rule.recommendation },
        files: new Set(),
      }
      accumulated.set(rule.id, entry)
    }
    entry.files.add(file.path)
    if (entry.files.size > 40) {
      const cut = [...entry.files].slice(40)
      for (const value of cut) entry.files.delete(value)
    }
  }

  for (const file of files) {
    for (const rule of FILE_RULES) if (rule.test(file)) add(rule, file)
  }

  const hasDocker = files.some(file => /(?:^|\/)dockerfile$|docker-compose\.ya?ml$/i.test(file.path))
  const hasIac = files.some(file => /(?:^|\/)(?:serverless\.ya?ml|template\.ya?ml|samconfig\.toml|cdk\.json|[^/]+\.tf(?:vars)?)$/i.test(file.path))
  const hasCi = files.some(file => /(?:^|\/)(?:\.github\/workflows\/|gitlab-ci\.ya?ml|bitbucket-pipelines\.ya?ml|\.circleci\/)/.test(file.path))
  const hasTests = files.some(file => /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\./i.test(file.path))
  const usesHttpFramework = stack.some(item => ['Express', 'Fastify', 'Koa', 'NestJS'].includes(item))
  const hasHardening = dependenciesFromPackageJson(files).some(dep => /^helmet|\bexpress-rate-limit\b|@fastify\/helmet|fastify-rate-limit/.test(dep))

  const findingList: AnalyzerFinding[] = [...accumulated.values()].map(entry => ({
    ...entry.finding,
    files: [...entry.files].slice(0, FILES_PER_FINDING),
  }))
  if (usesHttpFramework && !hasHardening) {
    findingList.push({
      id: 'P-SIN-ENDURECIMIENTO',
      area: 'Seguridad',
      severity: 'Alta',
      title: 'Servidor HTTP sin endurecimiento de cabeceras',
      detail: 'Hay un framework HTTP (Express/Fastify/Koa/NestJS) sin helmet ni otra librería de cabeceras de seguridad en las dependencias.',
      files: ['package.json'],
      recommendation: 'Añade helmet y límites de tasa (express-rate-limit) para cabeceras seguras y protección básica.',
    })
  }
  if (stack.includes('Socket.IO') && !stack.includes('Redis')) {
    findingList.push({
      id: 'P-SOCKET-ADAPTADOR',
      area: 'Escalabilidad',
      severity: 'Media',
      title: 'Socket.IO con adaptador por defecto en memoria',
      detail: 'Los sockets viven en la memoria del proceso; con más de una instancia se pierden sincronizaciones.',
      files: ['package.json'],
      recommendation: 'Configura el adaptador Redis (@socket.io/redis-adapter) si vas a desplegar réplicas.',
    })
  }
  if (stats.files > 0 && !hasIac && !hasDocker) {
    findingList.push({
      id: 'P-SIN-DESPLIEGUE',
      area: 'Escalabilidad',
      severity: 'Info',
      title: 'Sin manifiesto de despliegue en contenedor o IaC',
      detail: 'No hay Dockerfile, docker-compose, Terraform ni SAM/Serverless que documenten cómo se despliega el sistema.',
      files: [],
      recommendation: 'Empaqueta en Docker o escribe infraestructura como código para reproducir el despliegue en AWS (ECS, Lambda).',
    })
  }
  if (stats.files > 0 && !hasCi) {
    findingList.push({
      id: 'P-SIN-CI',
      area: 'Escalabilidad',
      severity: 'Info',
      title: 'Sin integración continua visible',
      detail: 'El proyecto no declara workflows de CI (GitHub Actions, GitLab CI u otros).',
      files: [],
      recommendation: 'Agrega un workflow que ejecute lint, typecheck y pruebas en cada cambio.',
    })
  }
  if (stats.files > 0 && !hasTests) {
    findingList.push({
      id: 'P-SIN-PRUEBAS',
      area: 'Escalabilidad',
      severity: 'Info',
      title: 'No se detectan archivos de prueba',
      detail: 'No hay tests, especificaciones ni directorios de pruebas dentro de los archivos analizados.',
      files: [],
      recommendation: 'Incluye pruebas automatizadas para respaldar refactorizaciones y el uso de infraestructura.',
    })
  }

  findingList.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (a.area !== b.area) return a.area.localeCompare(b.area)
    return a.title.localeCompare(b.title)
  })

  const areaPenalty = (area: AnalyzerArea) => findingList.filter(item => item.area === area).reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0)
  const awsRecommendations = recommendAwsServices(files, stack, { hasDocker, hasIac, hasCi })
  const empty = stats.files === 0
  const security = empty ? 0 : CLAMP(100 - areaPenalty('Seguridad'))
  const scalability = empty ? 0 : CLAMP(100 - areaPenalty('Escalabilidad'))
  let cloudReadiness = empty
    ? 0
    : CLAMP(15 + (hasDocker ? 20 : 0) + (hasIac ? 30 : 0) + (hasCi ? 15 : 0) + (hasTests ? 5 : 0))
  if (findingList.some(item => item.severity === 'Critica')) cloudReadiness = Math.max(0, cloudReadiness - 10)
  const total = empty ? 0 : CLAMP(security * 0.4 + scalability * 0.3 + cloudReadiness * 0.3)

  return {
    name,
    source: { kind, origin },
    generatedAt: new Date().toISOString(),
    stats,
    stack,
    findings: findingList,
    awsRecommendations,
    recommendationsVersion: 2,
    scores: { security, scalability, cloudReadiness, total },
  }
}
