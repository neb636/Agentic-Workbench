import path from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
export default async (context) => {
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  await flipFuses(app, { version: FuseVersion.V1, [FuseV1Options.GrantFileProtocolExtraPrivileges]: false, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true });
};
