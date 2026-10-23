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

export type AwsInsight = {
  service: string
  category: string
  evidence: string[]
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
  aws: AwsInsight[]
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

type AwsPattern = {
  service: string
  category: string
  pattern: RegExp
}

type Accumulated = {
  finding: Omit<AnalyzerFinding, 'files'>
  files: Set<string>
}

type AwsWorking = {
  service: string
  category: string
  pattern: RegExp
  evidence: Set<string>
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

const AWS_PATTERNS: AwsPattern[] = [
  { service: 'Amazon S3', category: 'Almacenamiento de objetos', pattern: /(?:^|[^a-z0-9])s3(?![a-z0-9])|S3Client|aws_s3_|\.s3\.amazonaws\.com|bucketName|putObject|presigned/i },
  { service: 'AWS Lambda', category: 'Cómputo sin servidor', pattern: /\blambda\b|AWS_LAMBDA_FUNCTION_NAME|lambda_handler|\bserverless\.ya?ml/i },
  { service: 'Amazon API Gateway', category: 'Integraciones', pattern: /apigateway|aws_apigateway|api\.gateway/i },
  { service: 'Amazon DynamoDB', category: 'Base de datos NoSQL', pattern: /dynamodb|DocumentClient|aws_dynamodb_/i },
  { service: 'Amazon RDS / Aurora', category: 'Base de datos relacional', pattern: /\brds\b|aurora|aws_db_instance|aws_rds_cluster/i },
  { service: 'Amazon SQS', category: 'Colas de mensajes', pattern: /\bsqs\b|SendMessage|aws_sqs_/i },
  { service: 'Amazon SNS', category: 'Notificaciones', pattern: /\bsns\b|TopicArn|aws_sns_/i },
  { service: 'Amazon Cognito', category: 'Identidad y accesos', pattern: /cognito|userPool/i },
  { service: 'AWS Secrets Manager', category: 'Seguridad de secretos', pattern: /secretsmanager|getSecretValue|aws_secretsmanager_/i },
  { service: 'Parameter Store (SSM)', category: 'Seguridad de secretos', pattern: /GetParameter|aws_ssm_|\bssm\./i },
  { service: 'Amazon SES', category: 'Correo', pattern: /\bses\b|SendEmailCommand|aws_ses_/i },
  { service: 'Amazon CloudWatch', category: 'Observabilidad', pattern: /cloudwatch|aws_cloudwatch_/i },
  { service: 'Amazon CloudFront', category: 'Entrega de contenido (CDN)', pattern: /cloudfront|aws_cloudfront_/i },
  { service: 'Amazon ECS / Fargate', category: 'Contenedores', pattern: /\becs\b|fargate|aws_ecs_/i },
  { service: 'Amazon EKS', category: 'Contenedores Kubernetes', pattern: /\beks\b|aws_eks_/i },
  { service: 'Amazon ECR', category: 'Registro de contenedores', pattern: /\becr\b|aws_ecr_/i },
  { service: 'Amazon EC2', category: 'Cómputo virtual', pattern: /\bec2\b|aws_instance|AWS::EC2::/i },
  { service: 'Amazon EventBridge', category: 'Bus de eventos', pattern: /eventbridge|PutEvents|aws_cloudwatch_event_/i },
  { service: 'AWS Step Functions', category: 'Orquestación', pattern: /stepfunctions|aws_sfn_|stateMachine/i },
  { service: 'Amazon Redshift', category: 'Almacén de datos', pattern: /redshift/i },
  { service: 'ElastiCache / Redis', category: 'Caché administrada', pattern: /elasticache|aws_elasticache_/i },
  { service: 'Route 53', category: 'DNS', pattern: /route53|aws_route53_/i },
  { service: 'AWS Amplify', category: 'Despliegue de apps', pattern: /@?aws-amplify/i },
  { service: 'AWS CDK', category: 'Infraestructura como código', pattern: /@aws-cdk|aws-cdk-lib/i },
  { service: 'AWS CloudFormation / SAM', category: 'Infraestructura como código', pattern: /AWSTemplateFormatVersion|AWS::|samconfig/i },
  { service: 'Terraform AWS', category: 'Infraestructura como código', pattern: /(?:resource|provider)\s+"aws_/i },
  { service: 'Amazon OpenSearch', category: 'Búsqueda', pattern: /opensearch|elasticsearch/i },
  { service: 'Amazon Kinesis', category: 'Streaming de datos', pattern: /kinesis/i },
  { service: 'Elastic Beanstalk', category: 'Despliegue por plataforma', pattern: /elasticbeanstalk/i },
  { service: 'Amazon Bedrock', category: 'IA generativa', pattern: /bedrock|invokeModel/i },
  { service: 'Amazon Textract', category: 'IA de documentos', pattern: /textract/i },
  { service: 'Amazon Rekognition', category: 'IA de visión', pattern: /rekognition/i },
  { service: 'EFS / FSx', category: 'Almacenamiento compartido', pattern: /\befs\b|aws_efs_|aws_fsx/i },
  { service: 'AWS Batch', category: 'Cómputo por lotes', pattern: /aws_batch|AWS::Batch/i },
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

  const aws = new Map<string, AwsWorking>()
  for (const file of files) {
    const text = file.text ?? ''
    for (const rule of FILE_RULES) if (rule.test(file)) add(rule, file)
    for (const hint of AWS_PATTERNS) {
      if (!hint.pattern.test(text)) continue
      let insight: AwsWorking | undefined = aws.get(hint.service)
      if (!insight) {
        insight = { service: hint.service, category: hint.category, evidence: new Set<string>(), pattern: hint.pattern }
        aws.set(hint.service, insight)
      }
      if (insight.evidence.size < 12) insight.evidence.add(file.path)
    }
  }

  const hasDocker = files.some(file => /(?:^|\/)dockerfile$|docker-compose\.ya?ml$/i.test(file.path))
  const hasIac = files.some(file => /(?:^|\/)(?:serverless\.ya?ml|template\.ya?ml|samconfig\.toml|\.tf|\.tfvars)$/.test(file.path))
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
  const awsList: AwsInsight[] = [...aws.values()].map(insight => ({
    service: insight.service,
    category: insight.category,
    evidence: [...insight.evidence],
  }))
  const empty = stats.files === 0
  const security = empty ? 0 : CLAMP(100 - areaPenalty('Seguridad'))
  const scalability = empty ? 0 : CLAMP(100 - areaPenalty('Escalabilidad'))
  let cloudReadiness = empty
    ? 0
    : CLAMP(15 + (hasDocker ? 20 : 0) + (hasIac ? 30 : 0) + (hasCi ? 15 : 0) + (hasTests ? 5 : 0) + Math.min(15, awsList.length * 3))
  if (findingList.some(item => item.severity === 'Critica')) cloudReadiness = Math.max(0, cloudReadiness - 10)
  const total = empty ? 0 : CLAMP(security * 0.4 + scalability * 0.3 + cloudReadiness * 0.3)

  return {
    name,
    source: { kind, origin },
    generatedAt: new Date().toISOString(),
    stats,
    stack,
    findings: findingList,
    aws: awsList.sort((a, b) => b.evidence.length - a.evidence.length || a.service.localeCompare(b.service)),
    scores: { security, scalability, cloudReadiness, total },
  }
}
