/**
 * A semantic bucket for a resource/data `type` string - network, compute,
 * storage, etc. Used only by `inferResourceCategory` below and, in turn,
 * nodeDetail.ts's `CURATED_ATTRIBUTES` (which per-category attribute, if
 * any, is worth surfacing as a node's detail line). Deliberately unrelated
 * to icons.ts's `IconCategory` now - node icons key off *kind*
 * (resource/data/module/...), not this semantic category; the two used to
 * be the same type before that split.
 */
export type ResourceCategory =
  | 'network'
  | 'compute'
  | 'storage'
  | 'database'
  | 'security'
  | 'container'
  | 'messaging'
  | 'monitoring'
  | 'generic';

/**
 * Ordered, most-specific/least-ambiguous-first keyword rules: `inferResourceCategory`
 * walks this list top to bottom and returns the first category whose keyword
 * list matches a substring of the resource `type`. Order matters - Terraform
 * resource-type substrings across Azure/AWS/GCP genuinely collide in a few
 * spots:
 *
 *   - `kubernetes`/`_aks`/`_eks` (e.g. "azurerm_kubernetes_cluster",
 *     "aws_eks_cluster") must resolve to `compute` (a cluster of compute
 *     nodes), not `database` - even though those types also contain the bare
 *     substring "cluster", which `database`'s keyword list also matches
 *     (for things like "cache_cluster"/managed database clusters). Putting
 *     the `compute` rule ahead of the `database` rule means a Kubernetes
 *     cluster type is matched (and returns) at the `compute` rule and never
 *     reaches `database`'s generic `cluster` keyword.
 *   - `security_group` (AWS/Azure's NSG-equivalent) is filed under `network`,
 *     not `security`: a security group is fundamentally a network ACL
 *     construct (an allow/deny rule list attached to network interfaces/
 *     subnets), not an identity/secrets/certificate construct. `security` is
 *     reserved for identity/secrets/certs/policy (key vaults, IAM roles,
 *     KMS keys, managed identities, etc).
 *   - `container_group` (e.g. Azure Container Instances / a compute node
 *     running containers) is filed under `compute`, while `container` (this
 *     category) is reserved for container *image* concerns - registries -
 *     since those are closer to an artifact store than a running workload.
 *   - `compute`'s keyword list intentionally does NOT include a bare
 *     "instance" substring: real database resource types like
 *     "aws_rds_cluster_instance", "aws_db_instance", "aws_docdb_cluster_instance",
 *     and "aws_neptune_cluster_instance" also contain "instance" as a
 *     substring, and since `compute` is checked before `database`, a bare
 *     "instance" keyword would misclassify all of those as `compute`. Instead,
 *     the specific compute resource-type fragments that actually need an
 *     "instance" match ("aws_instance" itself, and "spot_instance" for spot
 *     instance requests) are listed explicitly - neither collides with any
 *     database type's substring.
 */
const RULES: ReadonlyArray<{ category: ResourceCategory; keywords: readonly string[] }> = [
  {
    category: 'network',
    keywords: [
      'network',
      'vnet',
      'subnet',
      'vpc',
      'route',
      'gateway',
      'dns',
      'load_balancer',
      'lb_',
      'firewall',
      'nsg',
      'security_group',
    ],
  },
  {
    category: 'compute',
    keywords: [
      'kubernetes',
      '_aks',
      '_eks',
      'aws_instance',
      'spot_instance',
      '_vm',
      'virtual_machine',
      'compute',
      'container_group',
      'app_service',
      'function_app',
      'lambda',
      'autoscal',
    ],
  },
  {
    category: 'storage',
    keywords: ['storage', 'bucket', 'blob', '_disk', 'volume', 'file_share', 'fsx'],
  },
  {
    category: 'database',
    keywords: [
      'sql',
      'database',
      '_db_',
      'cosmosdb',
      'dynamodb',
      '_rds',
      'postgres',
      'mysql',
      'redis',
      'cache_cluster',
      'cluster',
    ],
  },
  {
    category: 'security',
    keywords: ['key_vault', 'secret', 'certificate', '_iam_', '_role', 'policy', 'kms', 'identity'],
  },
  {
    category: 'container',
    keywords: ['container_registry', '_ecr', 'docker'],
  },
  {
    category: 'messaging',
    keywords: ['queue', 'sqs', 'sns', 'topic', 'event_hub', 'service_bus', 'pubsub'],
  },
  {
    category: 'monitoring',
    keywords: ['monitor', 'log_analytics', 'cloudwatch', 'diagnostic', 'alert', 'metric'],
  },
];

/**
 * Infers a `ResourceCategory` from a Terraform resource/data `type` string
 * (e.g. "azurerm_virtual_network", "aws_instance", "random_pet") using the
 * ordered substring keyword rules in `RULES` above. Falls back to `generic`
 * for anything unmatched - Terraform's provider-agnostic utility resources
 * (`random_pet`, `local_file`, `null_resource`, `time_sleep`,
 * `tls_private_key`, `archive_file`, etc.) have no sensible cloud-resource
 * category and should land here rather than being forced into one that
 * doesn't fit.
 */
export function inferResourceCategory(type: string): ResourceCategory {
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => type.includes(keyword))) {
      return rule.category;
    }
  }
  return 'generic';
}
