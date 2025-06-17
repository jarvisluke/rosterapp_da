import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  memo
} from 'react';
import AddonInput from './AddonInput';
import ItemSelect from './ItemSelect';
import { apiClient, ApiError } from '../../util/api';
import CollapsibleSection from './CollapsibleSection';
import CharacterDisplay from './CharacterDisplay';
import SimulationReport from './SimulationReport';
import CombinationsDisplay from './CombinationsDisplay';
import AdditionalOptions, { DEFAULT_OPTIONS } from './AdditionalOptions';
import EquipmentSection from './EquipmentSection';
import { SimcParser } from './SimcParser';

const SimulationButton = memo(({ canSimulate, isSimulating, onRun }) => {
  return (
    canSimulate && (
      <div
        className="position-fixed bottom-0 start-0 w-100 bg-body py-3"
        style={{ zIndex: 1000 }}
      >
        <div className="container text-center">
          <button
            className="btn btn-primary"
            disabled={isSimulating}
            onClick={onRun}
          >
            {isSimulating ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                Simulating...
              </>
            ) : 'Run Simulation'}
          </button>
        </div>
      </div>
    )
  );
});

function Simc() {
  const [simulationResult, setSimulationResult] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [characterDisplayData, setCharacterDisplayData] = useState(null);
  const [hasValidData, setHasValidData] = useState(false);

  // Refs to hold data and avoid re-render
  const rawSimcInputRef = useRef('');
  const characterInfoRef = useRef(null);
  const itemsDataRef = useRef(null);
  const simOptionsRef = useRef(DEFAULT_OPTIONS);
  const equippedCombinationRef = useRef(null);
  const userCombinationsRef = useRef([]);

  const simulationUtilsRef = useRef({
    formatItemForSimC: (slotKey, item) => {
      if (!item) return '';
      let output = `${slotKey}=,id=${item.id}`;
      if (item.enchant_id || item.enchant) {
        output += `,enchant_id=${item.enchant_id || item.enchant}`;
      }
      if ((item.gems && item.gems.length > 0) || (item.gem_id && item.gem_id.length > 0)) {
        const gems = item.gems || item.gem_id || [];
        if (gems.length > 0 && gems[0]) {
          output += `,gem_id=${gems.join('/')}`;
        }
      }
      if ((item.bonusIds && item.bonusIds.length > 0) || (item.bonus_list && item.bonus_list.length > 0) || (item.bonus_id && item.bonus_id.length > 0)) {
        const bonusList = item.bonusIds || item.bonus_list || item.bonus_id || [];
        if (bonusList.length > 0) {
          output += `,bonus_id=${bonusList.join('/')}`;
        }
      }
      if (item.crafted_stats && item.crafted_stats.length > 0) {
        output += `,crafted_stats=${item.crafted_stats.join('/')}`;
      }
      return output;
    },
    createEquippedCombination: (itemsData) => {
      if (!itemsData) return null;
      const skippedSlots = ['tabard', 'shirt'];
      const equippedGear = {};
      Object.entries(itemsData).forEach(([slotKey, data]) => {
        if (!skippedSlots.includes(slotKey) && data.equipped) {
          if (slotKey === 'rings') {
            if (Array.isArray(data.equipped)) {
              if (data.equipped[0]) equippedGear['finger1'] = data.equipped[0];
              if (data.equipped[1]) equippedGear['finger2'] = data.equipped[1];
            }
          } else {
            equippedGear[slotKey] = data.equipped;
          }
        }
      });
      return equippedGear;
    }
  });

  const resultsRef = useRef(null);
  const wsRef = useRef(null); // WebSocket instance ref

  const MemoizedSimulationReport = useMemo(
    () => memo(() => (
      <SimulationReport
        htmlContent={simulationResult}
        height="500px"
        characterName={characterDisplayData?.name || 'character'}
      />
    )),
    [simulationResult, characterDisplayData?.name]
  );

  const parseAndValidateData = useCallback((data) => {
    if (!data || !data.rawInput) {
      rawSimcInputRef.current = '';
      characterInfoRef.current = null;
      itemsDataRef.current = null;
      equippedCombinationRef.current = null;
      userCombinationsRef.current = [];
      setCharacterDisplayData(null);
      setHasValidData(false);
      setParseError(null);
      return;
    }

    try {
      rawSimcInputRef.current = data.rawInput;
      const extractedCharacterInfo = SimcParser.extractCharacterInfo(data.rawInput);
      const validation = SimcParser.validateCharacterInfo(extractedCharacterInfo);

      if (!validation.valid) {
        throw new Error(`Character validation failed: ${validation.error}`);
      }

      characterInfoRef.current = extractedCharacterInfo;
      itemsDataRef.current = data.items;
      equippedCombinationRef.current = simulationUtilsRef.current.createEquippedCombination(data.items);
      userCombinationsRef.current = [];

      setCharacterDisplayData(data.character);
      setHasValidData(true);
      setParseError(null);

    } catch (error) {
      console.error('Error parsing SimC data:', error);
      characterInfoRef.current = null;
      itemsDataRef.current = null;
      equippedCombinationRef.current = null;
      userCombinationsRef.current = [];
      setCharacterDisplayData(null);
      setHasValidData(false);
      setParseError(error.message);
    }
  }, []);

  const handleDataUpdate = useCallback((data) => {
    parseAndValidateData(data);
  }, [parseAndValidateData]);

  const handleCombinationsUpdate = useCallback((newCombinations) => {
    userCombinationsRef.current = newCombinations;
    console.log(`Updated combinations: ${newCombinations.length} combinations`);
  }, []);

  const handleOptionsChange = useCallback((newOptions) => {
    simOptionsRef.current = newOptions;
  }, []);

  const addSimulationOptions = useCallback((inputText) => {
    const options = simOptionsRef.current;
    let optionsArr = [];
    optionsArr.push(`max_time=${options.general.fightDuration.value}`);
    if (!options.general.optimalRaidBuffs.value) {
      optionsArr.push('optimal_raid=0');
      Object.entries(options.buffs).forEach(([id, buff]) => {
        if (buff.category === 'override') {
          const simcKey = id.replace(/([A-Z])/g, '_$1').toLowerCase();
          optionsArr.push(`${buff.category}.${simcKey}=${buff.value ? 1 : 0}`);
        }
      });
    }
    Object.entries(options.buffs).forEach(([id, buff]) => {
      if (buff.category === 'external_buffs') {
        const simcKey = id.replace(/([A-Z])/g, '_$1').toLowerCase();
        optionsArr.push(`${buff.category}.${simcKey}=${buff.value ? 1 : 0}`);
      }
    });
    return `${inputText}\n\n# Simulation Options\n${optionsArr.join('\n')}`;
  }, []);

  const formatCombinations = useCallback(() => {
    const characterInfo = characterInfoRef.current;
    const rawInput = rawSimcInputRef.current;
    const { createEquippedCombination, formatItemForSimC } = simulationUtilsRef.current;

    const equippedGear = equippedCombinationRef.current;
    const userCombos = userCombinationsRef.current;

    let combinationsText = '';
    const characterInfoString = SimcParser.createCharacterInfoString(characterInfo);
    combinationsText += `${characterInfoString}\n\n`;

    const lines = rawInput.split('\n');
    const additionalSettings = lines.filter(line => {
      if (line.startsWith('#') || line.startsWith('//')) return true;
      if (line.startsWith('talents=') || line.startsWith('professions=')) return true;
      return false;
    });
    if (additionalSettings.length > 0) {
      combinationsText += additionalSettings.join('\n') + '\n\n';
    }

    if (equippedGear) {
      combinationsText += `copy="Equipped"\n`;
      combinationsText += `### Currently Equipped Gear\n`;
      Object.entries(equippedGear).forEach(([slotKey, item]) => {
        const itemName = item.name || '';
        const itemLevel = item.itemLevel || item.level?.value || '';
        const itemInfo = [itemName, itemLevel].filter(Boolean).join(' ');
        if (itemInfo) {
          combinationsText += `# ${itemInfo}\n`;
        }
        combinationsText += `${formatItemForSimC(slotKey, item)}\n`;
      });
      combinationsText += '\n';
    }

    userCombos.forEach((combo, index) => {
      const comboNumber = index + 1;
      combinationsText += `copy="Combo ${comboNumber}"\n`;
      combinationsText += `### Gear Combination ${comboNumber}\n`;
      Object.entries(combo).forEach(([slotKey, item]) => {
        const itemName = item.name || '';
        const itemLevel = item.itemLevel || item.level?.value || '';
        const itemInfo = [itemName, itemLevel].filter(Boolean).join(' ');
        if (itemInfo) {
          combinationsText += `# ${itemInfo}\n`;
        }
        combinationsText += `${formatItemForSimC(slotKey, item)}\n`;
      });
      combinationsText += '\n';
    });

    return addSimulationOptions(combinationsText);
  }, [addSimulationOptions]);

  const canSimulate = useMemo(() => {
    return hasValidData && characterInfoRef.current && rawSimcInputRef.current;
  }, [hasValidData]);

  const scrollToResults = useCallback(() => {
    if (resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const closeWebSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // Ignore errors on close
      }
      wsRef.current = null;
    }
  }, []);

  const runSimulation = useCallback(() => {
    const characterInfo = characterInfoRef.current;
    const rawInput = rawSimcInputRef.current;
    if (!characterInfo || !rawInput) return;

    setIsSimulating(true);
    setSimulationResult(null);

    // Prepare input
    let input;
    if (userCombinationsRef.current.length > 0) {
      input = formatCombinations();
    } else {
      const lines = rawInput.split('\n').filter(line => !line.startsWith('Simulation input:'));
      const characterInfoString = SimcParser.createCharacterInfoString(characterInfo);
      const remainingLines = lines.filter(line => {
        if (line.startsWith('#') || line.startsWith('//')) return true;
        if (['level=', 'race=', 'region=', 'server=', 'role=', 'professions=',
          'spec=', 'talents=', 'covenant=', 'soulbind='].some(s => line.startsWith(s))) {
          return false;
        }
        return true;
      });
      input = characterInfoString + '\n\n' + remainingLines.join('\n');
      input = addSimulationOptions(input);
    }

    // Close existing connection if any
    closeWebSocket();

    try {
      // Open new websocket connection
      const socket = new WebSocket('ws://localhost:8000/api/simulate/stream');
      wsRef.current = socket;

      socket.onopen = () => {
        // Send simc_input base64 encoded
        const payload = JSON.stringify({
          simc_input: btoa(input)
        });
        socket.send(payload);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          // Possible message types: 'progress', 'output', 'error', 'complete'
          if (message.type === 'error') {
            alert(`Simulation error: ${message.content}`);
            setIsSimulating(false);
            closeWebSocket();
          } else if (message.type === 'output') {
            // Append output content (HTML) progressively or replace full output
            setSimulationResult(prev => {
              if (!prev) return message.content;
              // Append new content
              return prev + message.content;
            });
          } else if (message.type === 'progress') {
            // Could update progress UI here if desired
            // For now, ignore or log
            // console.log(`Progress: ${message.content}`);
          } else if (message.type === 'complete') {
            setIsSimulating(false);
            closeWebSocket();
            scrollToResults();
          }
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('WebSocket connection error. Please try again.');
        setIsSimulating(false);
        closeWebSocket();
      };

      socket.onclose = (event) => {
        // Cleanup
        wsRef.current = null;
        if (isSimulating) {
          // Unexpected close, notify user
          alert('WebSocket connection closed unexpectedly.');
          setIsSimulating(false);
        }
      };
    } catch (e) {
      console.error('WebSocket connection failed:', e);
      alert('Failed to connect to simulation server.');
      setIsSimulating(false);
    }
  }, [formatCombinations, addSimulationOptions, closeWebSocket, scrollToResults, isSimulating]);

  const handleSimulationClose = useCallback(() => {
    closeWebSocket();
    setIsSimulating(false);
    setSimulationResult(null);
  }, [closeWebSocket]);

  return (
    <div className="container mt-3 pb-5 mb-5">
      <div ref={resultsRef}>
        <MemoizedSimulationReport />
      </div>
      <AddonInput
        onDataUpdate={handleDataUpdate}
        skippedSlots={['tabard', 'shirt']}
      />
      {parseError && (
        <div className="alert alert-danger mt-3">
          <strong>Parse Error:</strong> {parseError}
        </div>
      )}
      <CharacterDisplay
        character={characterDisplayData}
        characterInfo={characterInfoRef.current}
      />
      {hasValidData && (
        <EquipmentSection
          itemsData={itemsDataRef.current}
          onCombinationsGenerated={handleCombinationsUpdate}
          characterInfo={characterInfoRef.current}
        />
      )}
      {hasValidData && (
        <CollapsibleSection title="Additional Options">
          <AdditionalOptions
            onChange={handleOptionsChange}
          />
        </CollapsibleSection>
      )}
      {hasValidData && (
        <CollapsibleSection title="Simulation Setup" defaultOpen={true}>
          <CombinationsDisplay
            combinations={userCombinationsRef.current}
            characterData={characterDisplayData}
            itemsData={itemsDataRef.current}
            characterInfo={characterInfoRef.current}
            onCombinationsChange={handleCombinationsUpdate}
          />
        </CollapsibleSection>
      )}
      <SimulationButton
        canSimulate={canSimulate}
        isSimulating={isSimulating}
        onRun={runSimulation}
      />
    </div>
  );
}

export default Simc;
