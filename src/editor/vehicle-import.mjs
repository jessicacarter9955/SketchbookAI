const AUTHORIZED_CARS = new Set(['5a9007d569a846548dbf352877550c4e','52a66c41cfcd4f999fb1b1c49bf24d70','e83da098149746b5a3ba6f1661645b09','4350c8de8fd740f582bd316c1fa010ff']);
export function isImportedVehicle(metadata={}){
 if(metadata.role==='vehicle')return true;
 if(metadata.role==='prop'||metadata.role==='pedestrian')return false;
 if(AUTHORIZED_CARS.has(String(metadata.uid||'').toLowerCase()))return true;
 return /\b(ferrari|lamborghini|bmw|porsche|mercedes|audi|bugatti|mclaren|supercar|sports car|sedan|coupe|automobile|race car|passenger car|car model|hatchback)\b/i.test(String(metadata.name||''));
}
