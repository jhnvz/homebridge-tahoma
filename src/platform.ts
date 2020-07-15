import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import OverkizAccessory from './accessories/OverkizAccessory';
import OverkizDevice from './api/models/OverkizDevice';
import OverkizClient from './api/OverkizClient';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class OverkizPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  private readonly client: OverkizClient;

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
      this.log.debug('Finished initializing platform:', this.config.name);

      this.client = new OverkizClient(log, config);

      // When this event is fired it means Homebridge has restored all cached accessories from disk.
      // Dynamic Platform plugins should only register new accessories after this event was fired,
      // in order to ensure they weren't added to homebridge already. This event can also be used
      // to start discovery of new accessories.
      this.api.on('didFinishLaunching', () => {
          log.debug('Executed didFinishLaunching callback');
          // run the method to discover / register your devices as accessories
          this.discoverDevices();
      });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  async configureAccessory(accessory: PlatformAccessory) {
      const device = new OverkizDevice(this.client, accessory.context.device);
      const classConstructor = await import('./accessories/widget/' + device.widget)
          .catch(() => import('./accessories/uiClass/' + device.uiClass))
          .then((c) => c.default)
          .catch(() => OverkizAccessory);
      new classConstructor(this, device, accessory);
      // add the restored accessory to the accessories cache so we can track if it has already been registered
      if(!this.accessories.map((a) => a.UUID).includes(accessory.UUID)) {
          this.accessories.push(accessory);
      }
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
      const devices = await this.client.getDeviceModels();

      // loop over the discovered devices and register each one if it has not already been registered
      for (const device of devices) {
          // see if an accessory with the same uuid has already been registered and restored from
          // the cached devices we stored in the `configureAccessory` method above
          let accessory = this.accessories.find(accessory => accessory.UUID === device.oid);

          if (accessory) {
              // the accessory already exists
              //this.log.info('Updating accessory:', accessory.displayName);
              
              const newaccessory = new this.api.platformAccessory(device.label, device.oid);
              newaccessory.context.device = device;
              await this.configureAccessory(newaccessory);
              const services = newaccessory.services.map((service) => service.UUID);
              accessory.services
                  .filter((service) => !services.includes(service.UUID))
                  .forEach((services) => accessory?.removeService(services));
              this.api.updatePlatformAccessories([accessory]);
              
          } else {
              // the accessory does not yet exist, so we need to create it
              this.log.info('Adding new accessory:', device.label);
              accessory = new this.api.platformAccessory(device.label, device.oid);
              accessory.context.device = device;
              await this.configureAccessory(accessory);
              this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          }

          this.log.info('Configuring accessory:', accessory.displayName);
          this.log.debug('\t' + device.uiClass + ' > ' + device.widget);
      }
      const uuids = devices.map((device) => device.oid);
      const deleted = this.accessories.filter((accessory) => !uuids.includes(accessory.UUID));
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, deleted);
  }
}