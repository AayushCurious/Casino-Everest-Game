var React = require('react');
var Tile = require('../components/Tile.jsx');
var Tiles = require('../../../server/lib/game/tiles');
var ClaimMenu = require('../components/ClaimMenu.jsx');
var Overlay = require('../components/Overlay.jsx');
var Constants = require('../../../server/lib/constants');
var classnames = require('classnames');
var socketbindings = require('../../lib/socketbindings');
var md5 = require('md5');

var Player = React.createClass({
  statics: {
    OWN_TURN: "in own turn",
    OUT_OF_TURN: "out of turn",
    HAND_OVER: "hand is over",
    winds: ['east', 'south', 'west', 'north'],
    windKanji: ['東', '南', '西', '北']
  },

  log() {
    var msg = Array.from(arguments).join(' ');
    this.setState({ log: this.state.log.concat([msg]) });
  },

  send(evt, payload) {
    payload.gameid = this.state.gameid;
    payload.handid = this.state.handid;
    payload.playerid = this.state.playerid;
    payload.playerposition = this.state.playerposition;
    this.props.socket.emit(evt, payload);
  },

  getInitialState() {
    return {
      socket: this.props.socket,
      // game data
      playerid: -1,
      gameid: -1,
      playerposition: -1,
      handid: -1,
      mode: Player.OUT_OF_TURN,
      score: 0,
      balance: '',
      // hand information
      dealtTile: -1,
      tiles: [],
      bonus: [],
      revealed: [],
      // discard information
      discard: false,
      discardPlayer: -1,
      // hand-end information
      winner: false,
      winTile: false,
      winType: false,
      // play log for this player
      log: []
    };
  },

  componentDidMount() {
    var socket = this.props.socket;
    socketbindings.bind(socket, this);
  },

  makeReady(gameid, handid, playerid, playerposition, score) {
    var state = { gameid, handid, playerid, playerposition, score, balance:'' };
    this.setState(state, () => {
      this.send("confirmed", state);
    });
  },

  /**
   * Render the player UI
   */
  render() {
    var winner = (this.state.mode === Player.HAND_OVER) && (this.state.winner === this.state.playerposition);
    var loser = (this.state.mode === Player.HAND_OVER) && (this.state.winner !== this.state.playerposition);
    var draw = (this.state.mode === Player.HAND_OVER) && (this.state.winner === -1);

    var classes = classnames("player", {
      active: this.state.mode === Player.OWN_TURN,
      winner: winner,
      loser: loser,
      draw: draw
    });

    var dclasses = classnames("discard", Player.winds[this.state.playerposition], {
      menu: this.state.claimMenu
    });

    var overlay = null;
    if (this.state.mode === Player.HAND_OVER) {
      var content = '';
      if (draw) { content = "The hand was a draw..."; }
      else if (winner) { content = "You won the hand!"; }
      else if (loser) { content = "Player "+this.state.winner+" won the hand."; }
      overlay = (
        <Overlay>
          {content}
          <pre>
            {JSON.stringify(this.state.balance,false,2)}
          </pre>
        </Overlay>
      );
    }

    return (
      <div>
        {overlay}

        <div className={classes}>
          <div className="score">
            score: { this.state.score }
          </div>
          <div className={dclasses}>
          { this.showDiscard() }
          </div>
          <div className="tiles">{ this.renderTiles(this.state.tiles, this.state.mode === Player.HAND_OVER, this.state.dealtTile) }</div>
          <div className="open">
            <span className="bonus">{ this.renderTiles(this.state.bonus, true) }</span>
            <span className="revealed">{ this.renderRevealed() }</span>
          </div>
          {
            /*
              <div className="log">{ this.state.log.map((msg,pos) => <p key={pos}>{msg}</p>).reverse() }</div>
            */
          }
        </div>
      </div>
    );
  },

  /**
   * Show the currently available discard
   */
  showDiscard() {
    if (this.state.discard === false) {
      return null;
    }
    if (this.state.claimMenu) {
      var chowPos = (this.state.discardPlayer+1) % 4;
      var mayChow = (chowPos === this.state.playerposition);
      return <ClaimMenu claim={this.claimDiscard} mayChow={mayChow}/>;
    }
    var ownDiscard = this.state.discardPlayer === this.state.playerposition;
    var onClick = ownDiscard ? null : this.claimMenu;
    var title = ownDiscard ? "your discard" : "discard tile "+Tiles.getTileName(this.state.discard)+", click to claim it!";
    return <Tile value={this.state.discard} ownDiscard={ownDiscard} onClick={onClick} title={title} />;
  },

  /**
   * Render the "open" tiles for this player
   */
  renderRevealed() {
    var tiles = [];
    this.state.revealed.forEach((set,p1) => {
      set.forEach((tile,p2) => {
        tiles.push(<Tile key={`${tile}-${p1}-${p2}`} value={tile} title={"revealed tile "+Tiles.getTileName(tile)}/>);
      });
    });
    return tiles;
  },

  /**
   * Render the in-hand tiles for this player
   */
  renderTiles(tiles, inactive, tileHighlight) {
    if (tiles.length === 0) {
      return null;
    }
    tiles.sort((a,b) => a-b);
    return tiles.map((tile,pos) => {
      var key = tile + '-' + pos;
      var onclick = inactive ? null : this.handleTileSelect(tile);

      var highlight = false;
      if (tile === tileHighlight && this.state.mode === Player.OWN_TURN) {
        highlight = true;
        tileHighlight = -1;
      }
      var ourTurn = (this.state.mode === Player.OWN_TURN);
      var title = Tiles.getTileName(tile) + (ourTurn && !inactive ? ", click to discard" : '');
      return <Tile highlight={highlight} key={key} value={tile} onClick={onclick} title={title}/>;
    });
  },


  /**
   * Add a tile to this player's bank of tiles
   */
  setInitialTiles(tiles) {
    this.log("setting tiles", tiles);
    this.setState({ tiles: tiles }, this.filterForBonus);
  },

  /**
   * Add a tile to this player's bank of tiles
   */
  addCompensationTiles(compensation) {
    var tiles = this.state.tiles;
    tiles = tiles.concat(compensation);
    tiles.sort((a,b) => a - b);
    this.setState({
      dealtTile: compensation[0],
      tiles: tiles
    }, this.filterForBonus);
  },

  /**
   * Add a tile to this player's bank of tiles
   */
  addTile(tile) {
    this.log("adding tile", tile);
    var tiles = this.state.tiles;
    tiles.push(tile);
    tiles.sort((a,b) => a - b);
    this.setState({
      dealtTile: tile,
      tiles: tiles,
      mode: Player.OWN_TURN,
      discard: false
    }, this.filterForBonus);
  },

  /**
   * When a player is dealt a tile, filter out any bonus tiles and make
   * sure to ask the game for one or more compensation tiles.
   */
  filterForBonus() {
    var bonus = [];
    var tiles = this.state.tiles;

    // move bonus tiles out of the player's hand.
    for(var i=tiles.length-1; i>=0; i--) {
      if (tiles[i] >= Constants.BONUS) {
        bonus.push(tiles.splice(i,1)[0]);
      }
    }

    if (bonus.length > 0) {
      this.setState({
        tiles: tiles,
        bonus: this.state.bonus.concat(bonus)
      }, () => {
        // request compensation tiles for any bonus tile found.
        console.log("requesting compensation for", bonus.join(','));
        this.send("compensate", { tiles: bonus });
      });
    }
  },

  /**
   * Click-handler for tiles.
   */
  handleTileSelect(tile) {
    return (evt) => {
      if (this.state.mode === Player.OWN_TURN) {
        // players can discard any tile from their playable tile
        // set during their own turn, but not at any other time.
        this.discardTile(tile);
      }
      // Clicking on tiles at any other point in time does nothing.
    };
  },

  /**
   * Player discards a tile from their set of playable tiles.
   */
  discardTile(tile) {
    this.log("discarding tile", tile);
    var tiles = this.state.tiles;
    var pos = tiles.indexOf(tile);
    if (pos === -1) {
      // that's an error
      console.error(`player is trying to discard a tile (${tile}) they do not have...`);
    }
    tiles.splice(pos,1);
    this.setState({
      dealtTile: -1,
      tiles,
      mode: Player.OUT_OF_TURN
    }, () => {
      this.send("discard", {
        tile: tile
      });
    });
  },

  /**
   * Toggle the internal flag that renders the claim menu rather than
   * the currently available discard tile.
   */
  claimMenu() {
    this.setState({ claimMenu: true });
    // Should this interrupt the play? It feels like it shouldn't,
    // as that would give players a way to take more time than is
    // allotted for a decision.
  },

  /**
   * Inform the game that this player wants to claim the currently available discard.
   */
  claimDiscard(claimType, winType) {
    this.setState({ claimMenu: false }, () => {
      if (claimType !== Constants.NOTILE) {
        this.send("claim", {
          tile: this.state.discard,
          claimType: claimType,
          winType: winType
        });
      }
    });
  },

  /**
   * Determine which tiles to form a set with.
   */
  processClaim(tile, claimType, winType) {
    this.log("claim for", tile, "("+claimType+")", "was accepted");

    // remove tile from hand twice and form set.
    // FIXME: TODO: synchronize this with server/lib/game/player.js
    var set = [];
    if (claimType === Constants.WIN && winType === Constants.PAIR) { set = this.formSet(tile,2); }
    if (claimType <= Constants.CHOW3) { set = this.formChow(tile, claimType); }
    if (claimType === Constants.PUNG) { set = this.formSet(tile, 3); }
    if (claimType === Constants.KONG) { set = this.formSet(tile, 4); }
    this.log("set:", set);

    var tiles = this.state.tiles;
    tiles.push(tile);
    set.forEach(tile => {
      var pos = tiles.indexOf(tile);
      tiles.splice(pos,1);
    });

    var revealed = this.state.revealed;
    revealed.push(set);

    this.setState({
      tiles,
      revealed,
      discard: false,
      mode: Player.OWN_TURN
    }, this.verify);

    // notify server of our reveal
    this.send("reveal", {
      set: set
    });
  },

  // utility function
  formChow(tile, chowtype) {
    if (chowtype === Constants.CHOW1) return [tile, tile+1, tile+2];
    if (chowtype === Constants.CHOW2) return [tile-1, tile, tile+1];
    if (chowtype === Constants.CHOW3) return [tile-2, tile-1, tile];
  },

  // utility function
  formSet(tile, howmany) {
    var set = [];
    while(howmany--) { set.push(tile); }
    return set;
  },

  /**
   * Generate a hash based on this player's tiles, bonus tiles, and revealed tiles.
   */
  getDigest() {
    var list = this.state.tiles.concat(this.state.bonus);
    this.state.revealed.forEach(set => { list = list.concat(set); });
    list.sort();
    var digest = md5(list.join(''));
    this.log("confirming synchronized state. tiles:",list,"md5:",digest);
    return digest;
  },

  /**
   * Ask the server to verify our tile state.
   */
  verify() {
    console.log("verifying",this.state.playerposition,":",this.state.tiles,this.state.bonus,this.state.revealed);
    this.send("verify", {
      tiles: this.state.tiles,
      bonus: this.state.bonus,
      revealed: this.state.revealed,
      digest: this.getDigest()
    });
  },

  /**
   * If we did not pass verification, we need to inspect the game logs immediately.
   */
  verification(result) {
    if (result === false) {
      alert("player "+this.state.playerposition+" failed hand verification!");
    }
    this.log("verification:",result);
  },

  /**
   * Hand ended, ending in a draw.
   */
  finishDraw() {
    this.finish(-1, Constants.NOTILE, Constants.NOTHING);
  },

  /**
   * Hand ended, ending in a win by one of the players.
   */
  finishWin(playerposition, tile, winType) {
    this.finish(playerposition, tile, winType);
  },

  /**
   * Hand ended.
   * pid = -1 => draw
   * pid > -1 => winning player
   */
  finish(playerposition, tile, winType) {
    this.setState({
      mode: Player.HAND_OVER,
      discard: false,
      winner: playerposition,
      winTile: tile,
      winType: winType
    }, () => { console.log(this.state); });
  },

  /**
   * Score was updated based on a hand being won by someone.
   */
  updateScore(score, balance) {
    this.setState({ score, balance });
  }
});

module.exports = Player;
