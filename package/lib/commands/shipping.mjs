import { fetchShopPolicies } from '../graphql.mjs';

async function runShipping(domain) {
  try {
    const policyMap = await fetchShopPolicies([{ shop_domain: domain }]);
    const policy = policyMap.get(domain);

    if (policy?.shippingPolicyText) {
      console.log(policy.shippingPolicyText);
    } else if (policy?.shippingPolicyUrl) {
      console.log(policy.shippingPolicyUrl);
    } else {
      console.log(`No shipping policy found for ${domain}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function shippingCommand(program) {
  program
    .command('shipping <domain>')
    .description('View shipping policy for a store')
    .action(runShipping);
}
