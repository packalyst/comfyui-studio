import PipSourceCard from '../../../components/plugins/PipSourceCard';
import PackagesPanel from '../../../components/plugins/PackagesPanel';

/**
 * /plugins/python/packages — pip index-url shortcut + installed package
 * list with install/uninstall actions.
 */
export default function Packages() {
  return (
    <div className="space-y-4">
      <PipSourceCard />
      <PackagesPanel />
    </div>
  );
}
