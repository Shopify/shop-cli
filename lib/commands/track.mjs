import { fetchOrderById } from '../graphql.mjs';
import { formatTrackingDetail, formatTrackerDetail, isTracker } from '../formatter.mjs';

async function trackOrder(idOrUuid, opts) {
  try {
    const item = await fetchOrderById(idOrUuid);
    if (!item) {
      console.error(`Order/tracker not found: ${idOrUuid}`);
      process.exit(1);
    }

    if (isTracker(item)) {
      if (opts.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        console.log(formatTrackerDetail(item));
      }
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify({
        uuid: item.uuid,
        name: item.name,
        deliveryStatus: item.deliveryStatus,
        displayStatus: item.displayStatus,
        etaInfo: item.etaInfo,
        trackers: item.trackers?.nodes || [],
        statusPageUrl: item.statusPageUrl,
      }, null, 2));
    } else {
      console.log(formatTrackingDetail(item));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

export function trackCommand(program) {
  program
    .command('track <id>')
    .description('Show tracking & delivery info for an order or tracked package')
    .option('--json', 'Output as JSON')
    .action(trackOrder);
}
