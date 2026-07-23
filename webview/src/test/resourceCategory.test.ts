import * as assert from 'node:assert/strict';
import { inferResourceCategory } from '../resourceCategory';
import type { ResourceCategory } from '../resourceCategory';

function expectCategory(type: string, expected: ResourceCategory): void {
  assert.equal(
    inferResourceCategory(type),
    expected,
    `expected "${type}" -> "${expected}", got "${inferResourceCategory(type)}"`
  );
}

describe('inferResourceCategory', () => {
  describe('network', () => {
    it('matches azurerm_virtual_network', () => expectCategory('azurerm_virtual_network', 'network'));
    it('matches aws_vpc', () => expectCategory('aws_vpc', 'network'));
    it('matches azurerm_subnet', () => expectCategory('azurerm_subnet', 'network'));
  });

  describe('compute', () => {
    it('matches aws_instance', () => expectCategory('aws_instance', 'compute'));
    it('matches azurerm_linux_virtual_machine', () => expectCategory('azurerm_linux_virtual_machine', 'compute'));
    it('matches azurerm_kubernetes_cluster', () => expectCategory('azurerm_kubernetes_cluster', 'compute'));
    it('matches aws_lambda_function', () => expectCategory('aws_lambda_function', 'compute'));
  });

  describe('storage', () => {
    it('matches azurerm_storage_account', () => expectCategory('azurerm_storage_account', 'storage'));
    it('matches aws_s3_bucket', () => expectCategory('aws_s3_bucket', 'storage'));
    it('matches azurerm_managed_disk', () => expectCategory('azurerm_managed_disk', 'storage'));
  });

  describe('database', () => {
    it('matches azurerm_mssql_database', () => expectCategory('azurerm_mssql_database', 'database'));
    it('matches aws_rds_cluster_instance', () => expectCategory('aws_rds_cluster_instance', 'database'));
    it('matches aws_dynamodb_table', () => expectCategory('aws_dynamodb_table', 'database'));
  });

  describe('security', () => {
    it('matches azurerm_key_vault', () => expectCategory('azurerm_key_vault', 'security'));
    it('matches aws_iam_role', () => expectCategory('aws_iam_role', 'security'));
    it('matches azurerm_key_vault_certificate', () => expectCategory('azurerm_key_vault_certificate', 'security'));
  });

  describe('container', () => {
    it('matches aws_ecr_repository', () => expectCategory('aws_ecr_repository', 'container'));
    it('matches azurerm_container_registry', () => expectCategory('azurerm_container_registry', 'container'));
  });

  describe('messaging', () => {
    it('matches aws_sqs_queue', () => expectCategory('aws_sqs_queue', 'messaging'));
    it('matches azurerm_servicebus_topic', () => expectCategory('azurerm_servicebus_topic', 'messaging'));
  });

  describe('monitoring', () => {
    it('matches azurerm_monitor_diagnostic_setting', () =>
      expectCategory('azurerm_monitor_diagnostic_setting', 'monitoring'));
    it('matches aws_cloudwatch_metric_alarm', () => expectCategory('aws_cloudwatch_metric_alarm', 'monitoring'));
  });

  describe('generic (provider-agnostic utility resources)', () => {
    it('matches random_pet', () => expectCategory('random_pet', 'generic'));
    it('matches local_file', () => expectCategory('local_file', 'generic'));
    it('matches tls_private_key', () => expectCategory('tls_private_key', 'generic'));
    it('matches null_resource', () => expectCategory('null_resource', 'generic'));
    it('matches time_sleep', () => expectCategory('time_sleep', 'generic'));
  });

  describe('generic (unrecognized fallback)', () => {
    it('falls back to generic for a made-up/unrecognized resource type', () =>
      expectCategory('foobar_widget', 'generic'));
  });

  describe('documented ambiguity resolutions', () => {
    it('resolves azurerm_kubernetes_cluster to compute, not database, despite containing "cluster"', () =>
      expectCategory('azurerm_kubernetes_cluster', 'compute'));

    it('resolves aws_eks_cluster to compute, not database, despite containing "cluster"', () =>
      expectCategory('aws_eks_cluster', 'compute'));

    // The code's own comment (resourceCategory.ts) states security_group is
    // filed under `network`, not `security`, because it's an NSG-style
    // network ACL construct rather than an identity/secrets/certs concern.
    // This matches what RULES actually encodes: 'security_group' appears as
    // a `network` keyword, and `network`'s rule is evaluated before
    // `security`'s, so this resolves to `network` as documented - not a
    // surprise here.
    it('resolves aws_security_group to network (per the documented NSG-is-a-network-construct rule), not security', () =>
      expectCategory('aws_security_group', 'network'));

    it('resolves azurerm_network_security_group to network, not security', () =>
      expectCategory('azurerm_network_security_group', 'network'));
  });
});
