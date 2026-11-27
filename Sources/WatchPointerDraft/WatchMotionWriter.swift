// UNVERIFIED HARDWARE GATE. Watch as BLE central WRITES to a Mac peripheral.
// Not notifications. watchOS cannot advertise CBPeripheralManager services.
// End-to-end transport is untested. Phone-relay alternative is also untested.

#if false
import CoreBluetooth
import Foundation

final class WatchMotionWriter: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let serviceUUID = CBUUID(string: "D4A1C0DE-0001-4000-A000-000000000001")
    static let writeUUID = CBUUID(string: "D4A1C0DE-0001-4000-A000-000000000002")

    private var central: CBCentralManager?
    private var target: CBPeripheral?
    private var writeChar: CBCharacteristic?

    func start() {
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func writeMotionPacket(_ data: Data) {
        guard let target, let writeChar else { return }
        target.writeValue(data, for: writeChar, type: .withResponse)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: [Self.serviceUUID], options: nil)
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        target = peripheral
        peripheral.delegate = self
        central.stopScan()
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.serviceUUID])
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        peripheral.services?.forEach { peripheral.discoverCharacteristics([Self.writeUUID], for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        writeChar = service.characteristics?.first { $0.uuid == Self.writeUUID }
    }
}
#endif
